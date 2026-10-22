'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { marketApi, type AppMetadataResult, type CreateAnalysisInput, type ReviewCluster } from '@/lib/market-client';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import type { HistoryEntry, MarketSnapshot, MarketUser, Sentiment } from '@/types/market';

const groups: Array<{ key: Sentiment; title: string; label: string }> = [
  { key: 'positive', title: 'Loved', label: 'Positive' },
  { key: 'average', title: 'Mixed', label: 'Average' },
  { key: 'negative', title: 'Frustrated', label: 'Negative' }
];

type AnalysisProgress = 'findingApps' | 'loadingMetadata' | 'fetchingReviews' | 'generatingThemes' | 'saving';

const analysisProgressLabels: Record<AnalysisProgress, string> = {
  findingApps: 'Finding similar apps…',
  loadingMetadata: 'Loading app details…',
  fetchingReviews: 'Collecting recent reviews…',
  generatingThemes: 'Generating review themes…',
  saving: 'Saving your snapshot…'
};
const guestSnapshotTransferKey = 'app-competition-analysis:guest-snapshot-transfer';

type GuestSnapshotTransfer = {
  snapshots: MarketSnapshot[];
  completedAnalysisIds: string[];
};

function formatMentions(count: number): string {
  const value = count >= 1000 ? `${(count / 1000).toFixed(count % 1000 === 0 ? 0 : 1)}k` : count.toLocaleString();
  return `${value} mentions`;
}

function displayReviewText(example: string): string {
  const lines = example.split(/\r?\n/);
  if (lines.length > 2 && lines[0].trim().toLocaleLowerCase() === lines[1].trim().toLocaleLowerCase()) {
    return lines.slice(2).join('\n').trim();
  }
  return example.trim();
}

function createTemporarySnapshot(
  description: string,
  suggestedAppName: string,
  apps: AppMetadataResult[],
  themesByApp: Array<{ appIndex: number; groups: Record<Sentiment, ReviewCluster[]> }>
): MarketSnapshot {
  const createdAt = new Date().toISOString();
  const ideaId = `temporary-${crypto.randomUUID()}`;
  const reviewCount = themesByApp.reduce((total, { groups: themes }) => total +
    (['positive', 'average', 'negative'] as Sentiment[]).reduce((groupTotal, sentiment) => groupTotal +
      themes[sentiment].reduce((themeTotal, theme) => themeTotal + theme.mentions, 0), 0), 0);
  const sentimentGroupCount = (['positive', 'average', 'negative'] as Sentiment[])
    .filter((sentiment) => themesByApp.some(({ groups: themes }) => themes[sentiment].length > 0)).length;
  const reviewCountLabel = reviewCount >= 1000
    ? `${(reviewCount / 1000).toFixed(1).replace(/\.0$/, '')}k`
    : String(reviewCount);

  return {
    idea: { id: ideaId, userId: '', name: suggestedAppName, description, createdAt },
    analysis: {
      id: `temporary-${crypto.randomUUID()}`,
      ideaId,
      similarAppCount: apps.length,
      reviewsScannedCount: reviewCount,
      sentimentGroupCount,
      createdAt
    },
    competitors: apps.map((app, appIndex) => {
      const appThemes = themesByApp.find((entry) => entry.appIndex === appIndex)?.groups;
      const reviewThemes = {} as MarketSnapshot['competitors'][number]['reviewThemes'];
      for (const sentiment of ['positive', 'average', 'negative'] as Sentiment[]) {
        reviewThemes[sentiment] = (appThemes?.[sentiment] ?? []).map((theme) => ({
          id: `temporary-${appIndex}-${sentiment}-${theme.clusterId}`,
          name: theme.summary,
          example: theme.exampleReview,
          mentions: theme.mentions
        }));
      }
      return {
        id: `temporary-${appIndex}-${crypto.randomUUID()}`,
        name: app.name,
        appSummary: app.appSummary,
        url: app.appleAppStoreUrl ?? app.googlePlayUrl,
        appleAppStoreUrl: app.appleAppStoreUrl,
        googlePlayUrl: app.googlePlayUrl,
        rating: app.averageUserRating,
        similarityPercent: null,
        reviewThemes
      };
    }),
    hasUnassignedReviewThemes: false,
    summary: {
      similarAppCount: apps.length,
      reviewsScannedCount: reviewCount,
      reviewCountLabel,
      sentimentGroupCount
    },
    isDemo: false,
    isTemporary: true
  };
}

function createAnalysisInput(snapshot: MarketSnapshot): CreateAnalysisInput {
  const apps = snapshot.competitors.map((competitor) => {
    let appleAppStoreUrl = competitor.appleAppStoreUrl ?? null;
    let googlePlayUrl = competitor.googlePlayUrl ?? null;
    if (!appleAppStoreUrl && !googlePlayUrl && competitor.url) {
      try {
        const url = new URL(competitor.url);
        if (url.hostname === 'apps.apple.com') appleAppStoreUrl = competitor.url;
        if (url.hostname === 'play.google.com') googlePlayUrl = competitor.url;
      } catch {
        // The write API will reject malformed or unsupported store URLs.
      }
    }
    if (!competitor.rating || competitor.rating <= 0) {
      throw new Error(`Cannot save ${competitor.name}: its store rating is missing.`);
    }
    return {
      name: competitor.name,
      appSummary: competitor.appSummary,
      appleAppStoreUrl,
      googlePlayUrl,
      averageUserRating: competitor.rating,
      reviewCount: null,
      errors: {}
    };
  });

  return {
    description: snapshot.idea.description,
    suggestedAppName: snapshot.idea.name,
    apps,
    reviewThemesByApp: snapshot.competitors.map((competitor, appIndex) => ({
      appIndex,
      groups: Object.fromEntries((['negative', 'average', 'positive'] as Sentiment[]).map((sentiment) => [
        sentiment,
        competitor.reviewThemes[sentiment].map((theme, clusterId) => ({
          clusterId,
          summary: theme.name,
          exampleReview: theme.example,
          mentions: theme.mentions
        }))
      ])) as Record<Sentiment, ReviewCluster[]>
    }))
  };
}

function readGuestSnapshotTransfer(): GuestSnapshotTransfer | null {
  try {
    const stored = window.sessionStorage.getItem(guestSnapshotTransferKey);
    if (!stored) return null;
    const parsed: unknown = JSON.parse(stored);
    if (typeof parsed !== 'object' || parsed === null ||
        !Array.isArray((parsed as GuestSnapshotTransfer).snapshots) ||
        !Array.isArray((parsed as GuestSnapshotTransfer).completedAnalysisIds)) return null;
    return parsed as GuestSnapshotTransfer;
  } catch {
    return null;
  }
}

export default function HomePage() {
  const [currentUser, setCurrentUser] = useState<MarketUser | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [guestSnapshots, setGuestSnapshots] = useState<MarketSnapshot[]>([]);
  const [importingGuestSnapshots, setImportingGuestSnapshots] = useState(false);
  const [guestTransferError, setGuestTransferError] = useState('');
  const guestTransferInFlight = useRef(false);
  const [description, setDescription] = useState('');
  const [snapshot, setSnapshot] = useState<MarketSnapshot | null>(null);
  const [selectedCompetitorId, setSelectedCompetitorId] = useState<string | null>(null);
  const [group, setGroup] = useState<Sentiment>('positive');
  const [showAll, setShowAll] = useState(false);
  const [page, setPage] = useState<'home' | 'explore'>('home');
  const [loading, setLoading] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState<AnalysisProgress | null>(null);
  const [deletingIdeaId, setDeletingIdeaId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState('');
  const [historyError, setHistoryError] = useState('');
  const charCount = description.length;

  function toast(message: string) {
    setToastMessage(message);
    window.setTimeout(() => setToastMessage(''), 2600);
  }

  function beginSignIn() {
    try {
      const previousTransfer = readGuestSnapshotTransfer();
      const snapshots = new Map((previousTransfer?.snapshots ?? []).map((entry) => [entry.analysis.id, entry]));
      guestSnapshots.forEach((entry) => snapshots.set(entry.analysis.id, entry));
      if (snapshots.size > 0) {
        window.sessionStorage.setItem(guestSnapshotTransferKey, JSON.stringify({
          snapshots: [...snapshots.values()],
          completedAnalysisIds: previousTransfer?.completedAnalysisIds ?? []
        } satisfies GuestSnapshotTransfer));
      }
      window.location.assign('/login');
    } catch (error) {
      console.error('Could not prepare temporary analyses for sign-in.', error);
      toast('Could not prepare your temporary analyses. Please try again.');
    }
  }

  async function loadHistory() {
    try {
      setHistoryError('');
      setHistory(await marketApi.listHistory());
    } catch (error) {
      console.error('Could not load saved research:', error);
      setHistoryError('Could not load saved research. Start the app with its API server.');
      setHistory([]);
    }
  }

  async function importGuestSnapshots() {
    if (guestTransferInFlight.current) return;
    const transfer = readGuestSnapshotTransfer();
    if (!transfer) return;
    const completed = new Set(transfer.completedAnalysisIds);
    const pendingSnapshots = transfer.snapshots.filter((entry) => !completed.has(entry.analysis.id));
    if (pendingSnapshots.length === 0) {
      window.sessionStorage.removeItem(guestSnapshotTransferKey);
      setGuestSnapshots([]);
      return;
    }

    let importedCount = 0;
    guestTransferInFlight.current = true;
    setImportingGuestSnapshots(true);
    setGuestTransferError('');
    try {
      for (const guestSnapshot of pendingSnapshots) {
        try {
          await marketApi.createAnalysis(createAnalysisInput(guestSnapshot));
        } catch (error) {
          console.error('Could not save a temporary guest analysis to the signed-in account.', error);
          setGuestSnapshots(pendingSnapshots);
          await loadHistory();
          setGuestTransferError(`Could not save all temporary analyses. ${importedCount ? `${importedCount} saved. ` : ''}Try again to save the rest.`);
          return;
        }

        importedCount += 1;
        completed.add(guestSnapshot.analysis.id);
        try {
          window.sessionStorage.setItem(guestSnapshotTransferKey, JSON.stringify({
            snapshots: transfer.snapshots,
            completedAnalysisIds: [...completed]
          } satisfies GuestSnapshotTransfer));
        } catch (error) {
          console.error('Could not update the temporary analysis transfer checkpoint.', error);
          await loadHistory();
          setGuestTransferError('An analysis was saved, but its transfer status could not be recorded. Check Your Work before retrying.');
          return;
        }
      }

      window.sessionStorage.removeItem(guestSnapshotTransferKey);
      setGuestSnapshots([]);
      await loadHistory();
      if (importedCount > 0) {
        toast(`${importedCount} temporary ${importedCount === 1 ? 'analysis was' : 'analyses were'} saved to Your Work.`);
      }
    } finally {
      guestTransferInFlight.current = false;
      setImportingGuestSnapshots(false);
    }
  }

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('view') === 'explore') setPage('explore');
    marketApi.getCurrentUser().then(async (user) => {
      setCurrentUser(user);
      if (user) {
        await loadHistory();
        await importGuestSnapshots();
      }
      else {
        setHistory([]);
        setHistoryError('');
      }
    }).catch((error: unknown) => {
      console.error('Could not initialize market APIs:', error);
      setHistoryError('Account status could not be loaded. You can still explore as a guest.');
    }).finally(() => setAuthReady(true));
  }, []);

  function showHome() {
    setPage('home');
    setSnapshot(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function showExplore() {
    setPage('explore');
    setSnapshot(null);
    setSelectedCompetitorId(null);
    setDescription('');
    setGroup('positive');
    setShowAll(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function showSnapshot(next: MarketSnapshot | null) {
    if (!next) {
      toast('That saved snapshot could not be found.');
      return;
    }
    setSnapshot(next);
    setSelectedCompetitorId(next.competitors[0]?.id ?? null);
    setGroup('positive');
    setShowAll(false);
    setDescription(next.idea.description);
    setPage('explore');
    window.setTimeout(() => document.getElementById('results')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  }

  async function openHistory(entry: HistoryEntry) {
    try {
      showSnapshot(await marketApi.getSnapshot(entry.analysisId));
    } catch (error) {
      console.error('Could not load saved market snapshot:', error);
      toast(error instanceof Error ? error.message : 'Could not load that saved snapshot.');
    }
  }

  async function deleteIdea(entry: HistoryEntry) {
    if (!window.confirm(`Delete “${entry.name}” and its saved market snapshot? This cannot be undone.`)) return;
    setDeletingIdeaId(entry.ideaId);
    try {
      await marketApi.deleteIdea(entry.ideaId);
      setHistory((current) => current.filter((item) => item.ideaId !== entry.ideaId));
      if (snapshot?.idea.id === entry.ideaId) {
        setSnapshot(null);
        setSelectedCompetitorId(null);
        setDescription('');
      }
      toast('Idea and saved snapshot deleted.');
    } catch (error) {
      console.error('Could not delete saved idea:', error);
      toast(error instanceof Error ? error.message : 'Could not delete this idea. Please try again.');
    } finally {
      setDeletingIdeaId(null);
    }
  }

  function removeGuestSnapshot(analysisId: string) {
    setGuestSnapshots((current) => current.filter((entry) => entry.analysis.id !== analysisId));
    if (snapshot?.analysis.id === analysisId) {
      setSnapshot(null);
      setSelectedCompetitorId(null);
      setDescription('');
    }
  }

  async function signOut() {
    await createSupabaseBrowserClient().auth.signOut();
    window.location.assign('/');
  }

  async function analyze() {
    const text = description.trim();
    if (text.length < 15) {
      toast('Add a little more detail so we can find relevant matches.');
      return;
    }
    if (text.length > 500) {
      toast('Please keep your idea under 500 characters.');
      return;
    }
    if (!authReady) {
      toast('Checking your sign-in status. Please try again in a moment.');
      return;
    }
    setLoading(true);
    setAnalysisProgress('findingApps');
    window.setTimeout(() => document.getElementById('results')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
    try {
      const similarApps = await marketApi.findSimilarApps(text);
      setAnalysisProgress('loadingMetadata');
      const appsWithMetadata = await marketApi.getAppMetadata(similarApps.apps);
      const ratedCompetitors = appsWithMetadata.flatMap((app) =>
        app.averageUserRating !== null && app.averageUserRating > 0 ? [app] : []
      );
      if (ratedCompetitors.length === 0) {
        throw new Error('None of the similar apps has a usable store rating, so there is not enough data to analyze.');
      }
      setAnalysisProgress('fetchingReviews');
      const appReviews = await marketApi.getReviews(ratedCompetitors);
      const reviewedCompetitors = appReviews.flatMap((app, appIndex) =>
        Object.values(app.reviews).some((reviews) => reviews.length > 0)
          ? [{ app, metadata: ratedCompetitors[appIndex] }]
          : []
      );
      if (reviewedCompetitors.length === 0) {
        throw new Error('No rated similar apps returned reviews. Try another idea and analyze again.');
      }
      const appsWithReviews = reviewedCompetitors.map(({ metadata }) => metadata);
      const appReviewsWithData = reviewedCompetitors.map(({ app }) => app);
      setAnalysisProgress('generatingThemes');
      const clusteredThemes = await marketApi.clusterReviews(appReviewsWithData);
      const minimumThemesPerSentiment = 3;
      const clustersByAppIndex = new Map(clusteredThemes.map((entry) => [entry.appIndex, entry]));
      const qualifiedApps = appsWithReviews.flatMap((app, appIndex) => {
        const themes = clustersByAppIndex.get(appIndex);
        if (!themes || !(['negative', 'average', 'positive'] as Sentiment[]).every((sentiment) =>
          themes.groups[sentiment].length >= minimumThemesPerSentiment
        )) return [];
        return [{ app, themes }];
      });
      if (qualifiedApps.length === 0) {
        throw new Error('No similar apps had at least 3 review themes in each sentiment group. Try another idea and analyze again.');
      }
      const appsToSave = qualifiedApps.map(({ app }) => app);
      const reviewThemesByApp = qualifiedApps.map(({ themes }, appIndex) => ({ ...themes, appIndex }));
      const removedCompetitors = appsWithReviews.length - qualifiedApps.length;
      if (removedCompetitors > 0) {
        console.info(`[analysis] excluded ${removedCompetitors} app(s) without 3 themes in all sentiment groups`);
      }
      console.info('[review clusters by app]', reviewThemesByApp.map(({ appIndex, groups: themes }) => ({
        app: appsToSave[appIndex]?.name,
        themes: Object.fromEntries(Object.entries(themes).map(([sentiment, clusters]) => [
          sentiment,
          clusters.map(({ summary, mentions }) => ({ summary, mentions }))
        ]))
      })));
      if (currentUser) {
        setAnalysisProgress('saving');
        const saved = await marketApi.createAnalysis({
          ideaId: snapshot && !snapshot.isTemporary && snapshot.idea.description === text ? snapshot.idea.id : undefined,
          description: text,
          suggestedAppName: similarApps.suggestedAppName,
          apps: appsToSave,
          reviewThemesByApp
        });
        await loadHistory();
        const savedSnapshot = await marketApi.getSnapshot(saved.analysisId);
        if (!savedSnapshot) throw new Error('The analysis was saved, but its snapshot could not be loaded.');
        showSnapshot(savedSnapshot);
      } else {
        const temporarySnapshot = createTemporarySnapshot(text, similarApps.suggestedAppName, appsToSave, reviewThemesByApp);
        setGuestSnapshots((current) => [temporarySnapshot, ...current]);
        showSnapshot(temporarySnapshot);
        toast('Temporary snapshot ready. Sign up or log in to save it to your account.');
      }
    } catch (error) {
      console.error('Market analysis failed:', error);
      toast(error instanceof Error ? error.message : 'We could not analyze the market. Please try again.');
    } finally {
      setLoading(false);
      setAnalysisProgress(null);
    }
  }

  function onIdeaKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') void analyze();
  }

  async function exportSummary() {
    if (!snapshot) return;
    const lines = [
      'App Competition Analysis — Market Snapshot',
      'Illustrative sample data',
      '',
      `App idea: ${snapshot.idea.description}`,
      '',
      'Similar apps',
      ...snapshot.competitors.map((app, index) => `${index + 1}. ${app.name} — ${app.appSummary}${app.url ? ` — ${app.url}` : ''}`),
      '',
      'Common review themes',
      ...snapshot.competitors.flatMap((app) => [
        app.name,
        ...groups.flatMap(({ key, title }) => [title.toUpperCase(), ...app.reviewThemes[key].map((theme) => `• ${theme.name} (${formatMentions(theme.mentions)}) — ${theme.example}`)]),
        ''
      ])
    ];
    const blobUrl = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/plain' }));
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = 'app-competition-analysis-market-snapshot.txt';
    link.click();
    URL.revokeObjectURL(blobUrl);
    toast('Your market snapshot is ready to download.');
  }

  const visibleCompetitors = snapshot ? (showAll ? snapshot.competitors : snapshot.competitors.slice(0, 5)) : [];
  const selectedCompetitor = snapshot?.competitors.find((app) => app.id === selectedCompetitorId) ?? null;
  const currentThemes = selectedCompetitor?.reviewThemes[group] ?? [];
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#home" aria-label="App Competition Analysis home" onClick={(event) => { event.preventDefault(); showHome(); }}>
          <span className="brand-mark"><span /><span /><span /><span /></span>
          <span>App Competition Analysis</span>
        </a>
        <div className="workspace-label">WORKSPACE</div>
        <button className={`nav-item ${page === 'home' ? 'active' : ''}`} onClick={showHome}><span className="nav-icon">⌂</span><span>Home</span></button>
        <button className={`nav-item ${page === 'explore' && !snapshot ? 'active' : ''}`} onClick={showExplore}><span className="nav-icon">⌕</span><span>Explore market</span><span className="nav-count">01</span></button>
        <div className="side-rule" />
        <div className="workspace-label">YOUR WORK</div>
        <div className="history-list">
          {importingGuestSnapshots && <div className="empty-history">Saving your temporary analyses to your account…</div>}
          {guestTransferError && <div className="empty-history">{guestTransferError}<button type="button" className="history-entry-open" onClick={() => void importGuestSnapshots()}>Try saving again</button></div>}
          {currentUser ? (historyError ? <div className="empty-history">{historyError}</div> : history.length ? history.map((entry) => (
            <div className={`history-entry ${snapshot?.idea.id === entry.ideaId ? 'active' : ''}`} key={entry.analysisId}>
              <button type="button" className="history-entry-open" title={entry.description} aria-current={snapshot?.analysis.id === entry.analysisId ? 'page' : undefined} onClick={() => void openHistory(entry)}>
                <span className="history-entry-icon">⌕</span><span className="history-entry-text"><strong>{entry.name}</strong><small>{new Date(entry.createdAt).toLocaleDateString()}</small></span>
              </button>
              <button type="button" className="history-entry-delete" aria-label={`Delete idea ${entry.name}`} title="Delete idea" disabled={loading || deletingIdeaId !== null} onClick={() => void deleteIdea(entry)}>
                {deletingIdeaId === entry.ideaId ? <span className="delete-pending" aria-hidden="true">…</span> : <svg aria-hidden="true" viewBox="0 0 16 16"><path d="M3 4.5h10M6 4.5V3h4v1.5m2 0-.5 8h-7l-.5-8m3 2.5v3m2-3v3" /></svg>}
              </button>
            </div>
          )) : <div className="empty-history">No research yet. Start with an idea.</div>) : guestSnapshots.length ? guestSnapshots.map((entry) => (
            <div className={`history-entry ${snapshot?.analysis.id === entry.analysis.id ? 'active' : ''}`} key={entry.analysis.id}>
              <button type="button" className="history-entry-open" title={entry.idea.description} aria-current={snapshot?.analysis.id === entry.analysis.id ? 'page' : undefined} onClick={() => showSnapshot(entry)}>
                <span className="history-entry-icon">⌕</span><span className="history-entry-text"><strong>{entry.idea.name}</strong><small>{new Date(entry.analysis.createdAt).toLocaleDateString()} · Temporary</small></span>
              </button>
              <button type="button" className="history-entry-delete" aria-label={`Remove temporary analysis ${entry.idea.name}`} title="Remove temporary analysis" onClick={() => removeGuestSnapshot(entry.analysis.id)}>×</button>
            </div>
          )) : <div className="empty-history">{historyError || <>Guest analyses stay here until you leave or reload.<a href="/login">Sign up / Log in to save</a></>}</div>}
        </div>
        <div className="sidebar-bottom">
          {currentUser ? <><div className="avatar">{currentUser.initials}</div><div className="profile"><strong>{currentUser.name}</strong><span>{currentUser.email}</span></div><button className="more-btn" aria-label="Sign out" title="Sign out" onClick={() => void signOut()}>↪</button></> : <a className="sidebar-auth-cta" href="/login" onClick={(event) => { event.preventDefault(); beginSignIn(); }}>Sign up / Log in <span>↗</span></a>}
        </div>
      </aside>

      <main id="top" className="main-content">
        <header className="topbar"><div className="breadcrumb">Workspace <span>/</span> <strong>{snapshot?.idea.name ?? (page === 'home' ? 'Home' : 'Stage 1 · Explore the market')}</strong></div><div className="topbar-right">{currentUser ? <><span className="signed-in-label">{currentUser.email}</span><button className="signout-btn" onClick={() => void signOut()}>Sign out</button></> : <a className="signout-btn auth-nav-cta" href="/login" onClick={(event) => { event.preventDefault(); beginSignIn(); }}>Sign up / Log in</a>}</div></header>

        {page === 'home' ? <section className="home-view">
          <div className="home-eyebrow"><span className="eyebrow-line" /> A CLEARER VIEW OF YOUR COMPETITION</div>
          <div className="home-hero">
            <div className="home-copy"><h1>Build with a better<br /><em>read on the market.</em></h1><p>App Competition Analysis helps aspiring founders understand the apps already serving their idea. Explore competitors, learn what their users love and dislike, and find opportunities worth building for.</p><button className="home-cta" onClick={showExplore}>Start with your idea <span>↗</span></button><div className="home-footnote"><span>✳</span> Start with a description. Get a useful first look at the market.</div></div>
            <div className="home-visual" aria-hidden="true"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="orbit-center"><span className="brand-mark"><span /><span /><span /><span /></span></div><div className="orbit-node node-one">✳</div><div className="orbit-node node-two">⌕</div><div className="orbit-node node-three">◈</div><div className="orbit-caption">IDEA → INSIGHT → EVIDENCE</div></div>
          </div>
          <div className="stage-navigation" aria-label="Research stages">
            <button className="stage-nav-item current" onClick={showExplore}><span className="stage-nav-number">01</span><span className="stage-nav-copy"><strong>Explore the market</strong><small>Find similar apps and review patterns</small></span><span className="stage-nav-state">AVAILABLE <b>↗</b></span></button>
            <button className="stage-nav-item upcoming" onClick={() => toast('This stage is planned for a future release.')}><span className="stage-nav-number">02</span><span className="stage-nav-copy"><strong>Verify in the app</strong><small>See a phone agent explore screens</small></span><span className="stage-nav-state">COMING SOON</span></button>
          </div>
          <div className="home-lower"><span>YOUR IDEA, BETTER INFORMED</span></div>
        </section> : <div className="stage-one-view">
          <button className="back-home" onClick={showHome}>← All stages</button>
          <section className="intro">
            <div className="eyebrow"><span className="eyebrow-line" /> COMPETITIVE RESEARCH, WITHOUT THE SPREADSHEET</div>
            <h1>Find the gaps<br />in your <em>next big idea.</em></h1>
            <p className="intro-copy">Describe the app you want to build. We’ll map the landscape and surface what people love, and what they wish worked better.</p>
          </section>

          <section className="idea-card" aria-label="Describe your app idea">
            <div className="card-label"><span className="spark">✳</span> YOUR APP IDEA <span className="optional">Be specific — the details help us find better matches.</span></div>
            <label className="sr-only" htmlFor="idea">Describe the app you want to build</label>
            <textarea id="idea" rows={3} placeholder="An app that helps people plan meals around what’s already in their fridge, with recipes that adapt to dietary needs…" value={description} onChange={(event) => setDescription(event.target.value)} onKeyDown={onIdeaKeyDown} />
            <div className="form-footer"><span className="char-count"><span>{charCount}</span> / 500</span><div className="form-actions"><button className="analyze-btn" disabled={loading || !authReady} onClick={() => void analyze()}><span>{loading && analysisProgress ? analysisProgressLabels[analysisProgress] : !authReady ? 'Checking account…' : snapshot && snapshot.idea.description === description.trim() ? 'Re-analyze the market' : 'Analyze the market'}</span><span className="arrow">↗</span></button></div></div>
          </section>

          <div className="trust-note"><span className="lock">⌑</span> Competitor listings, ratings, and recent reviews are fetched live. Review themes are clustered separately for each app.</div>

          {loading ? <section className="results analysis-loading" id="results" aria-live="polite" aria-busy="true">
            <div className="results-head"><div><div className="section-kicker"><span className="live-pulse" /> MARKET SNAPSHOT <span className="demo-pill">IN PROGRESS</span></div><h2>Analyzing your idea</h2><p className="results-sub">{analysisProgress ? analysisProgressLabels[analysisProgress] : 'Preparing your market snapshot…'}</p></div></div>
            <div className="summary-strip"><div className="summary-item"><span className="summary-icon green">⌕</span><div><strong className="loading-value">—</strong><span>similar apps</span></div></div><div className="summary-divider" /><div className="summary-item"><span className="summary-icon violet">▤</span><div><strong className="loading-value">—</strong><span>reviews scanned</span></div></div><div className="summary-divider" /><div className="summary-item"><span className="summary-icon amber">◎</span><div><strong className="loading-value">—</strong><span>sentiment groups</span></div></div></div>
            <div className="analysis-grid">
              <section className="panel competitors-panel" aria-label="Similar apps being found"><div className="panel-heading"><div><span className="panel-index">01</span><h3>Similar apps</h3></div><span className="panel-meta">IN PROGRESS</span></div><div className="loading-panel-content"><span className="loading-status"><span className="loading-spinner" />{analysisProgress === 'findingApps' ? 'Finding similar apps…' : analysisProgress === 'loadingMetadata' ? 'Loading app details…' : 'Preparing competitor listings…'}</span><div className="loading-lines" aria-hidden="true"><i /><i /><i /></div></div></section>
              <section className="panel themes-panel" aria-label="Review themes being generated"><div className="panel-heading"><div><span className="panel-index">02</span><h3>Review themes</h3></div><span className="panel-meta">IN PROGRESS</span></div><div className="sentiment-tabs" role="tablist">{groups.map((item) => <span key={item.key} className={`sentiment-tab ${group === item.key ? 'active' : ''}`}>{item.title} <span>{item.label}</span></span>)}</div><div className="loading-panel-content"><span className="loading-status"><span className="loading-spinner" />{analysisProgress === 'generatingThemes' ? 'Generating review themes…' : analysisProgress === 'saving' ? 'Saving review themes…' : 'Collecting recent reviews…'}</span><div className="loading-lines theme-loading-lines" aria-hidden="true"><i /><i /><i /></div></div></section>
            </div>
          </section> : snapshot ? <section className="results" id="results" aria-live="polite">
            <div className="results-head"><div><div className="section-kicker"><span className="live-pulse" /> MARKET SNAPSHOT <span className="demo-pill">{snapshot.isTemporary ? 'TEMPORARY · NOT SAVED' : snapshot.isDemo ? 'ILLUSTRATIVE DATA' : 'LIVE APP LISTINGS'}</span></div><h2>{snapshot.idea.name}</h2><p className="results-sub">{snapshot.isTemporary ? 'This snapshot is temporary until you sign up or log in. We’ll save it to your account after you authenticate.' : 'A first look at the apps closest to your idea and the themes in each app’s recent reviews.'}</p></div><button className="export-btn" onClick={() => void exportSummary()}>↓ <span>Export summary</span></button></div>
            <div className="summary-strip"><div className="summary-item"><span className="summary-icon green">⌕</span><div><strong>{snapshot.summary.similarAppCount}</strong><span>similar apps</span></div></div><div className="summary-divider" /><div className="summary-item"><span className="summary-icon violet">▤</span><div><strong>{snapshot.summary.reviewCountLabel}</strong><span>reviews scanned</span></div></div><div className="summary-divider" /><div className="summary-item"><span className="summary-icon amber">◎</span><div><strong>{snapshot.summary.sentimentGroupCount}</strong><span>sentiment groups</span></div></div></div>
            <div className="analysis-grid">
              <section className="panel competitors-panel"><div className="panel-heading"><div><span className="panel-index">01</span><h3>Similar apps</h3></div><span className="panel-meta">{snapshot.summary.similarAppCount} APPS · SELECT AN APP</span></div><div className="competitor-list">{visibleCompetitors.map((app) => <div className={`competitor-row ${selectedCompetitorId === app.id ? 'selected' : ''}`} key={app.id}>{app.url ? <a className="competitor-name-link" href={app.url} target="_blank" rel="noopener noreferrer">{app.name}</a> : <strong className="competitor-name">{app.name}</strong>}<button type="button" className="competitor-select" aria-label={`Show review themes for ${app.name}`} aria-pressed={selectedCompetitorId === app.id} onClick={() => setSelectedCompetitorId(app.id)}><div className="app-info"><span>{app.appSummary}</span></div>{app.rating !== null && Number.isFinite(Number(app.rating)) && <span className="app-rating"><span className="star">★</span> {Number(app.rating).toFixed(1)}</span>}</button></div>)}</div><button className="view-all" onClick={() => setShowAll((value) => !value)}>{showAll ? 'Show fewer competitors' : 'View all competitors'} <span>{showAll ? '↑' : '→'}</span></button></section>
            <section className="panel themes-panel"><div className="panel-heading"><div><span className="panel-index">02</span><h3>{selectedCompetitor ? `What ${selectedCompetitor.name} reviewers say` : 'What reviewers say'}</h3></div></div><div className="sentiment-tabs" role="tablist">{groups.map((item) => <button key={item.key} className={`sentiment-tab ${group === item.key ? 'active' : ''}`} role="tab" aria-selected={group === item.key} onClick={() => setGroup(item.key)}>{item.title} <span>{item.label}</span></button>)}</div><div className="theme-list">{currentThemes.length ? currentThemes.map((theme) => <div className="theme-row" key={theme.id}><div className="theme-line"><strong className="theme-name">{theme.name}</strong><span className="theme-count">{formatMentions(theme.mentions)}</span></div><div className="theme-examples">{displayReviewText(theme.example)}</div></div>) : <p className="theme-examples">{snapshot?.hasUnassignedReviewThemes ? 'This older snapshot has review themes combined across apps. Re-analyze it to generate themes for each app.' : selectedCompetitor ? `No ${group} review themes are saved for ${selectedCompetitor.name} in this snapshot.` : 'Select an app to see its review themes.'}</p>}</div></section>
            </div>
          </section> : <section className="initial-state"><span className="initial-star">✳</span><div><strong>A little curiosity goes a long way.</strong><p>Start with your idea. We’ll help you see the market from your future customers’ point of view.</p></div><span className="initial-arrow">↗</span></section>}
          <footer className="page-footer"><span>APP COMPETITION ANALYSIS <span className="footer-dot">·</span> YOUR IDEA DESERVES A CLOSER LOOK</span></footer>
        </div>}
      </main>

      <div className={`toast ${toastMessage ? 'show' : ''}`} role="status">{toastMessage}</div>
    </div>
  );
}

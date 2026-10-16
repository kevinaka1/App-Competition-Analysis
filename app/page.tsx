'use client';

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { marketApi } from '@/lib/market-client';
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

function formatMentions(count: number): string {
  const value = count >= 1000 ? `${(count / 1000).toFixed(count % 1000 === 0 ? 0 : 1)}k` : count.toLocaleString();
  return `${value} mentions`;
}

export default function HomePage() {
  const [users, setUsers] = useState<MarketUser[]>([]);
  const [currentUserId, setCurrentUserId] = useState('');
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [description, setDescription] = useState('An app that helps people plan meals around what’s already in their fridge, with recipes that adapt to dietary needs.');
  const [snapshot, setSnapshot] = useState<MarketSnapshot | null>(null);
  const [selectedCompetitorId, setSelectedCompetitorId] = useState<string | null>(null);
  const [group, setGroup] = useState<Sentiment>('positive');
  const [showAll, setShowAll] = useState(false);
  const [page, setPage] = useState<'home' | 'explore'>('home');
  const [loading, setLoading] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState<AnalysisProgress | null>(null);
  const [toastMessage, setToastMessage] = useState('');
  const [historyError, setHistoryError] = useState('');
  const [roadmapOpen, setRoadmapOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const charCount = description.length;

  function toast(message: string) {
    setToastMessage(message);
    window.setTimeout(() => setToastMessage(''), 2600);
  }

  async function loadHistory(userId: string) {
    try {
      setHistoryError('');
      setHistory(await marketApi.listHistory(userId));
    } catch (error) {
      console.error('Could not load saved research:', error);
      setHistoryError('Could not load saved research. Start the app with its API server.');
      setHistory([]);
    }
  }

  useEffect(() => {
    marketApi.listUsers().then(async (list) => {
      setUsers(list);
      if (list[0]) {
        setCurrentUserId(list[0].id);
        await loadHistory(list[0].id);
      }
    }).catch((error: unknown) => {
      console.error('Could not initialize market APIs:', error);
      setHistoryError('Could not load saved research. Start the app with its API server.');
    });
  }, []);

  useEffect(() => {
    if (roadmapOpen) dialogRef.current?.showModal();
    else if (dialogRef.current?.open) dialogRef.current.close();
  }, [roadmapOpen]);

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

  async function selectUser(userId: string) {
    setCurrentUserId(userId);
    setSnapshot(null);
    setDescription('');
    await loadHistory(userId);
    showHome();
  }

  async function openHistory(entry: HistoryEntry) {
    try {
      showSnapshot(await marketApi.getSnapshot(entry.analysisId));
    } catch (error) {
      console.error('Could not load saved market snapshot:', error);
      toast(error instanceof Error ? error.message : 'Could not load that saved snapshot.');
    }
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
    if (!currentUserId) {
      toast('Select a user before saving this analysis.');
      return;
    }
    setLoading(true);
    setAnalysisProgress('findingApps');
    window.setTimeout(() => document.getElementById('results')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
    try {
      const similarApps = await marketApi.findSimilarApps(text);
      setAnalysisProgress('loadingMetadata');
      const appsWithMetadata = await marketApi.getAppMetadata(similarApps.apps);
      setAnalysisProgress('fetchingReviews');
      const appReviews = await marketApi.getReviews(appsWithMetadata);
      const reviewedCompetitors = appReviews.flatMap((app, appIndex) =>
        Object.values(app.reviews).some((reviews) => reviews.length > 0)
          ? [{ app, metadata: appsWithMetadata[appIndex] }]
          : []
      );
      if (reviewedCompetitors.length === 0) {
        throw new Error('No similar apps returned reviews. Try another idea and analyze again.');
      }
      const appsWithReviews = reviewedCompetitors.map(({ metadata }) => metadata);
      const appReviewsWithData = reviewedCompetitors.map(({ app }) => app);
      setAnalysisProgress('generatingThemes');
      const reviewThemesByApp = await marketApi.clusterReviews(appReviewsWithData);
      console.info('[review clusters by app]', reviewThemesByApp.map(({ appIndex, groups: themes }) => ({
        app: appsWithReviews[appIndex]?.name,
        themes: Object.fromEntries(Object.entries(themes).map(([sentiment, clusters]) => [
          sentiment,
          clusters.map(({ summary, mentions }) => ({ summary, mentions }))
        ]))
      })));
      setAnalysisProgress('saving');
      const saved = await marketApi.createAnalysis({
        userId: currentUserId,
        ideaId: snapshot?.idea.description === text ? snapshot.idea.id : undefined,
        description: text,
        suggestedAppName: similarApps.suggestedAppName,
        apps: appsWithReviews,
        reviewThemesByApp
      });
      await loadHistory(currentUserId);
      const savedSnapshot = await marketApi.getSnapshot(saved.analysisId);
      if (!savedSnapshot) throw new Error('The analysis was saved, but its snapshot could not be loaded.');
      showSnapshot(savedSnapshot);
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
      'Mobile App Agent — Market Snapshot',
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
    link.download = 'fieldnotes-market-snapshot.txt';
    link.click();
    URL.revokeObjectURL(blobUrl);
    toast('Your market snapshot is ready to download.');
  }

  const currentUser = users.find((user) => user.id === currentUserId);
  const visibleCompetitors = snapshot ? (showAll ? snapshot.competitors : snapshot.competitors.slice(0, 5)) : [];
  const selectedCompetitor = snapshot?.competitors.find((app) => app.id === selectedCompetitorId) ?? null;
  const currentThemes = selectedCompetitor?.reviewThemes[group] ?? [];
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#home" aria-label="Mobile App Agent home" onClick={(event) => { event.preventDefault(); showHome(); }}>
          <span className="brand-mark"><span /><span /><span /><span /></span>
          <span>fieldnotes<span className="brand-dot">.</span></span>
        </a>
        <div className="workspace-label">WORKSPACE</div>
        <button className={`nav-item ${page === 'home' ? 'active' : ''}`} onClick={showHome}><span className="nav-icon">⌂</span><span>Home</span></button>
        <button className={`nav-item ${page === 'explore' && !snapshot ? 'active' : ''}`} onClick={showExplore}><span className="nav-icon">⌕</span><span>Explore market</span><span className="nav-count">01</span></button>
        <button className="nav-item muted" title="Coming in a future stage" onClick={() => toast('This stage is planned for a future release.')}><span className="nav-icon">◈</span><span>Feature checks</span><span className="soon">SOON</span></button>
        <div className="side-rule" />
        <div className="workspace-label">YOUR WORK</div>
        <div className="history-list">
          {historyError ? <div className="empty-history">{historyError}</div> : history.length ? history.map((entry) => (
            <button className={`history-entry ${snapshot?.analysis.id === entry.analysisId ? 'active' : ''}`} key={entry.analysisId} title={entry.description} aria-current={snapshot?.analysis.id === entry.analysisId ? 'page' : undefined} onClick={() => void openHistory(entry)}>
              <span className="history-entry-icon">⌕</span><span className="history-entry-text"><strong>{entry.name}</strong><small>{new Date(entry.createdAt).toLocaleDateString()}</small></span>
            </button>
          )) : <div className="empty-history">{currentUserId ? 'No research yet. Start with an idea.' : 'Your research will show up here.'}</div>}
        </div>
        <div className="sidebar-bottom">
          <div className="avatar">{currentUser?.initials ?? '—'}</div><div className="profile"><strong>{currentUser?.name ?? 'Loading user'}</strong><span>Demo account</span></div><button className="more-btn" aria-label="More options">···</button>
        </div>
      </aside>

      <main id="top" className="main-content">
        <header className="topbar"><div className="breadcrumb">Workspace <span>/</span> <strong>{snapshot?.idea.name ?? (page === 'home' ? 'Home' : 'Stage 1 · Explore the market')}</strong></div><div className="topbar-right"><label className="demo-user-control"><span>DEMO USER</span><select aria-label="Switch demo user" value={currentUserId} onChange={(event) => void selectUser(event.target.value)}>{users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label><button className="help-btn" aria-label="About this demo" title="This MVP uses illustrative data">?</button></div></header>

        {page === 'home' ? <section className="home-view">
          <div className="home-eyebrow"><span className="eyebrow-line" /> A CLEARER VIEW OF YOUR COMPETITION</div>
          <div className="home-hero">
            <div className="home-copy"><h1>Build with a better<br /><em>read on the market.</em></h1><p>Mobile App Agent helps aspiring founders understand the apps already serving their idea. Explore competitors, learn what their users love and dislike, and find opportunities worth building for.</p><button className="home-cta" onClick={showExplore}>Start with your idea <span>↗</span></button><div className="home-footnote"><span>✳</span> Start with a description. Get a useful first look at the market.</div></div>
            <div className="home-visual" aria-hidden="true"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="orbit-center"><span className="brand-mark"><span /><span /><span /><span /></span></div><div className="orbit-node node-one">✳</div><div className="orbit-node node-two">⌕</div><div className="orbit-node node-three">◈</div><div className="orbit-caption">IDEA → INSIGHT → EVIDENCE</div></div>
          </div>
          <div className="stage-navigation" aria-label="Research stages">
            <button className="stage-nav-item current" onClick={showExplore}><span className="stage-nav-number">01</span><span className="stage-nav-copy"><strong>Explore the market</strong><small>Find similar apps and review patterns</small></span><span className="stage-nav-state">AVAILABLE <b>↗</b></span></button>
            <button className="stage-nav-item upcoming" onClick={() => toast('This stage is planned for a future release.')}><span className="stage-nav-number">02</span><span className="stage-nav-copy"><strong>Check features</strong><small>Compare your feature ideas</small></span><span className="stage-nav-state">COMING SOON</span></button>
            <button className="stage-nav-item upcoming" onClick={() => toast('This stage is planned for a future release.')}><span className="stage-nav-number">03</span><span className="stage-nav-copy"><strong>Verify in the app</strong><small>See a phone agent explore screens</small></span><span className="stage-nav-state">COMING SOON</span></button>
          </div>
          <div className="home-lower"><span>YOUR IDEA, BETTER INFORMED</span><span>One research journey, three stages <b>✳</b></span></div>
        </section> : <div className="stage-one-view">
          <button className="back-home" onClick={showHome}>← All stages</button>
          <section className="intro">
            <div className="eyebrow"><span className="eyebrow-line" /> COMPETITIVE RESEARCH, WITHOUT THE SPREADSHEET</div>
            <h1>Find the gaps<br />in your <em>next big idea.</em></h1>
            <p className="intro-copy">Describe the app you want to build. We’ll map the landscape and surface what people love, and what they wish worked better.</p>
            <div className="stepper"><div className="step active"><span className="step-num">01</span><span>Describe your idea</span></div><span className="step-line" /><div className="step future"><span className="step-num">02</span><span>Check features</span></div><span className="step-line" /><div className="step future"><span className="step-num">03</span><span>See it in action</span></div></div>
          </section>

          <section className="idea-card" aria-label="Describe your app idea">
            <div className="card-label"><span className="spark">✳</span> YOUR APP IDEA <span className="optional">Be specific — the details help us find better matches.</span></div>
            <label className="sr-only" htmlFor="idea">Describe the app you want to build</label>
            <textarea id="idea" rows={3} placeholder="An app that helps people plan meals around what’s already in their fridge, with recipes that adapt to dietary needs…" value={description} onChange={(event) => setDescription(event.target.value)} onKeyDown={onIdeaKeyDown} />
            <div className="form-footer"><span className="char-count"><span>{charCount}</span> / 500</span><div className="form-actions"><button className="analyze-btn" disabled={loading} onClick={() => void analyze()}><span>{loading && analysisProgress ? analysisProgressLabels[analysisProgress] : snapshot && snapshot.idea.description === description.trim() ? 'Re-analyze the market' : 'Analyze the market'}</span><span className="arrow">↗</span></button></div></div>
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
            <div className="results-head"><div><div className="section-kicker"><span className="live-pulse" /> MARKET SNAPSHOT <span className="demo-pill">{snapshot.isDemo ? 'ILLUSTRATIVE DATA' : 'LIVE APP LISTINGS'}</span></div><h2>{snapshot.idea.name}</h2><p className="results-sub">A first look at the apps closest to your idea and the themes in each app’s recent reviews.</p></div><button className="export-btn" onClick={() => void exportSummary()}>↓ <span>Export summary</span></button></div>
            <div className="summary-strip"><div className="summary-item"><span className="summary-icon green">⌕</span><div><strong>{snapshot.summary.similarAppCount}</strong><span>similar apps</span></div></div><div className="summary-divider" /><div className="summary-item"><span className="summary-icon violet">▤</span><div><strong>{snapshot.summary.reviewCountLabel}</strong><span>reviews scanned</span></div></div><div className="summary-divider" /><div className="summary-item"><span className="summary-icon amber">◎</span><div><strong>{snapshot.summary.sentimentGroupCount}</strong><span>sentiment groups</span></div></div></div>
            <div className="analysis-grid">
              <section className="panel competitors-panel"><div className="panel-heading"><div><span className="panel-index">01</span><h3>Similar apps</h3></div><span className="panel-meta">{snapshot.summary.similarAppCount} APPS · SELECT AN APP</span></div><div className="competitor-list">{visibleCompetitors.map((app) => <div className={`competitor-row ${selectedCompetitorId === app.id ? 'selected' : ''}`} key={app.id}>{app.url ? <a className="competitor-name-link" href={app.url} target="_blank" rel="noopener noreferrer">{app.name}</a> : <strong className="competitor-name">{app.name}</strong>}<button type="button" className="competitor-select" aria-label={`Show review themes for ${app.name}`} aria-pressed={selectedCompetitorId === app.id} onClick={() => setSelectedCompetitorId(app.id)}><div className="app-info"><span>{app.appSummary}</span></div>{app.rating !== null && Number.isFinite(Number(app.rating)) && <span className="app-rating"><span className="star">★</span> {Number(app.rating).toFixed(1)}</span>}</button></div>)}</div><button className="view-all" onClick={() => setShowAll((value) => !value)}>{showAll ? 'Show fewer competitors' : 'View all competitors'} <span>{showAll ? '↑' : '→'}</span></button></section>
            <section className="panel themes-panel"><div className="panel-heading"><div><span className="panel-index">02</span><h3>{selectedCompetitor ? `What ${selectedCompetitor.name} reviewers say` : 'What reviewers say'}</h3></div>{currentThemes.length > 0 && <button className="sort-btn" onClick={() => toast('Themes are ordered by number of mentions.')}>Most mentioned⌄</button>}</div><div className="sentiment-tabs" role="tablist">{groups.map((item) => <button key={item.key} className={`sentiment-tab ${group === item.key ? 'active' : ''}`} role="tab" aria-selected={group === item.key} onClick={() => setGroup(item.key)}>{item.title} <span>{item.label}</span></button>)}</div><div className="theme-list">{currentThemes.length ? currentThemes.map((theme) => <div className="theme-row" key={theme.id}><div className="theme-line"><strong className="theme-name">{theme.name}</strong><span className="theme-count">{formatMentions(theme.mentions)}</span></div><div className="theme-examples">{theme.example}</div></div>) : <p className="theme-examples">{snapshot?.hasUnassignedReviewThemes ? 'This older snapshot has review themes combined across apps. Re-analyze it to generate themes for each app.' : selectedCompetitor ? `No ${group} review themes are saved for ${selectedCompetitor.name} in this snapshot.` : 'Select an app to see its review themes.'}</p>}</div>{currentThemes.length > 0 && <div className="method-note"><span>✳</span><div><strong>How we find patterns</strong><p>Each app’s recent reviews are grouped by sentiment, embedded, and clustered by similarity. Each theme label summarizes its five centroid-nearest reviews.</p></div></div>}</section>
            </div>
            <section className="next-stage"><div className="next-icon">◈</div><div className="next-copy"><span className="section-kicker">COMING NEXT</span><h3>Go from market signals to real product proof.</h3><p>Check competitor features, then watch a phone agent explore the app and verify what’s actually there.</p></div><div className="stage-tags"><span>02 · Feature checks</span><span>03 · Phone agent</span></div><button className="notify-btn" onClick={() => setRoadmapOpen(true)}>Explore the roadmap <span>↗</span></button></section>
            <footer className="results-footer"><span>{snapshot.isDemo ? 'Illustrative sample data' : 'Live app listings and store ratings'} · app-specific review themes</span><span>Built for the curious <span className="footer-star">✳</span></span></footer>
          </section> : <section className="initial-state"><span className="initial-star">✳</span><div><strong>A little curiosity goes a long way.</strong><p>Start with your idea. We’ll help you see the market from your future customers’ point of view.</p></div><span className="initial-arrow">↗</span></section>}
          <footer className="page-footer"><span>FIELDNOTES <span className="footer-dot">·</span> YOUR IDEA DESERVES A CLOSER LOOK</span><span>Stage 1 MVP <span className="footer-dot">·</span> October 2026</span></footer>
        </div>}
      </main>

      <div className={`toast ${toastMessage ? 'show' : ''}`} role="status">{toastMessage}</div>
      <dialog ref={dialogRef} onClose={() => setRoadmapOpen(false)} onClick={(event) => { if (event.target === dialogRef.current) setRoadmapOpen(false); }}><button className="dialog-close" aria-label="Close" onClick={() => setRoadmapOpen(false)}>×</button><div className="dialog-mark">◈</div><div className="section-kicker">THE ROADMAP</div><h2>From insight to evidence.</h2><p>Feature checks and phone-agent evidence are planned next. This MVP demonstrates the first step with illustrative competitor and review data.</p><div className="roadmap-list"><div><b>02</b><span><strong>Feature checks</strong><small>Compare your feature list with app descriptions, docs, and reviews.</small></span><em>Planned</em></div><div><b>03</b><span><strong>Phone agent</strong><small>Explore competitor apps and capture evidence from real screens.</small></span><em>Planned</em></div></div><button className="dialog-done" onClick={() => setRoadmapOpen(false)}>Got it</button></dialog>
    </div>
  );
}

import { OpenAIEmbeddings } from '@langchain/openai';
import { kmeans } from 'ml-kmeans';
import OpenAI from 'openai';

export interface ReviewClusterInput {
    appIndex: number;
    sentiment: 'negative' | 'average' | 'positive';
    clusterId: number;
    mentions: number;
    centroidReview: string;
    exampleReview: string;
    topReviews: string[];
    reviews: ClusterReview[];
}

export interface ClusterReview {
    id: string;
    store: 'appleStore' | 'googlePlay';
    score: number;
    title: string | null;
    text: string;
    createdAt: string | null;
}

export interface ReviewClusterTheme {
    appIndex: number;
    clusterId: number;
    summary: string;
    exampleReview: string;
    mentions: number;
    reviews: ClusterReview[];
}

/** Embed review text with OpenAI and use k-means to find nearby review groups. */
export async function clusterReviews(
    inputReviews: ClusterReview[],
    sentiment: ReviewClusterInput['sentiment'],
    requestedClusters = 3,
    appIndex = 0
): Promise<ReviewClusterInput[]> {
    const reviews = inputReviews.map((review) => ({
        review,
        text: [review.title, review.text].filter(Boolean).join('\n').trim(),
        displayText: review.text.trim()
    })).filter(({ text }) => Boolean(text));
    if (!reviews.length) return [];

    const clusterCount = Math.min(requestedClusters, reviews.length);
    if (reviews.length === 1) {
        return [{ appIndex, sentiment, clusterId: 0, mentions: 1, centroidReview: reviews[0].text, exampleReview: reviews[0].displayText, topReviews: [reviews[0].text], reviews: [reviews[0].review] }];
    }

    const embeddings = new OpenAIEmbeddings({
        model: 'text-embedding-3-small',
        batchSize: 128
    });
    const vectors = await embeddings.embedDocuments(reviews.map(({ text }) => text));
    const result = kmeans(vectors, clusterCount, { initialization: 'kmeans++' });
    const grouped = Array.from({ length: clusterCount }, () => [] as Array<{ review: string; displayText: string; distance: number; sourceReview: ClusterReview }>);

    reviews.forEach(({ review, text, displayText }, index) => {
        const clusterId = result.clusters[index];
        grouped[clusterId].push({ review: text, displayText, distance: result.distance(vectors[index], result.centroids[clusterId]), sourceReview: review });
    });

    return grouped.map((cluster, clusterId) => {
        const closestReviews = [...cluster].sort((a, b) => a.distance - b.distance).slice(0, 5);
        return {
            appIndex,
            sentiment,
            clusterId,
            mentions: cluster.length,
            centroidReview: closestReviews[0].review,
            exampleReview: closestReviews[0].displayText,
            topReviews: closestReviews.map(({ review }) => review),
            reviews: cluster.map(({ sourceReview }) => sourceReview).slice(0, 50)
        };
    }).filter((cluster) => cluster.mentions > 0);
}

/** Ask OpenAI for a short theme phrase for each app-specific group of centroid-nearest reviews. */
export async function summarizeReviewClusters(clusters: ReviewClusterInput[]): Promise<Record<string, ReviewClusterTheme>> {
    if (!clusters.length) return {};
    if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured.');

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await openai.responses.create({
        model: process.env.OPENAI_MODEL || 'gpt-5.5',
        reasoning: { effort: 'low' },
        text: {
            format: {
                type: 'json_schema',
                name: 'review_cluster_themes',
                strict: true,
                schema: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        summaries: {
                            type: 'array',
                            items: {
                                type: 'object',
                                additionalProperties: false,
                                properties: {
                                    appIndex: { type: 'integer' },
                                    sentiment: { type: 'string', enum: ['negative', 'average', 'positive'] },
                                    clusterId: { type: 'integer' },
                                    summary: { type: 'string' }
                                },
                                required: ['appIndex', 'sentiment', 'clusterId', 'summary']
                            }
                        }
                    },
                    required: ['summaries']
                }
            }
        },
        input: [
            {
                role: 'system',
                content: 'Name the shared topic in each group of mobile app reviews. Each group belongs to one appIndex and sentiment. For every group, write a neutral, specific theme phrase of no more than 5 words. Do not infer details that are not supported by the reviews. Return exactly one summary for each provided appIndex, sentiment, and clusterId.'
            },
            {
                role: 'user',
                content: JSON.stringify(clusters.map(({ appIndex, sentiment, clusterId, centroidReview, topReviews }) => ({
                    appIndex,
                    sentiment,
                    clusterId,
                    centroidReview,
                    closestReviews: topReviews
                })))
            }
        ]
    });

    const parsed = JSON.parse(response.output_text) as {
        summaries: Array<{ appIndex: number; sentiment: ReviewClusterInput['sentiment']; clusterId: number; summary: string }>;
    };
    const keyFor = (appIndex: number, sentiment: ReviewClusterInput['sentiment'], clusterId: number) => `${appIndex}:${sentiment}:${clusterId}`;
    const summaries = new Map(parsed.summaries.map((item) => [keyFor(item.appIndex, item.sentiment, item.clusterId), item.summary.trim()]));
    return Object.fromEntries(clusters.map(({ appIndex, sentiment, clusterId, mentions, exampleReview, reviews }) => {
        const summary = summaries.get(keyFor(appIndex, sentiment, clusterId));
        if (!summary || summary.split(/\s+/).length > 5) throw new Error(`OpenAI returned an invalid theme phrase for app ${appIndex}, ${sentiment} cluster ${clusterId}.`);
        return [keyFor(appIndex, sentiment, clusterId), { appIndex, clusterId, summary, exampleReview, mentions, reviews }];
    }));
}

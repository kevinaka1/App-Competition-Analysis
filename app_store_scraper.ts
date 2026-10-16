import { reviews as googlePlayReviews, sort } from '@mradex77/google-play-scraper';
import { reviews as appleStoreReviews, type Review as ReviewResult } from '@perttu/app-store-scraper';

const first = await googlePlayReviews({
    appId: 'com.google.android.apps.translate',
    sort: sort.NEWEST,
    paginate: true,
});

let reviews_arr = [];

while (first.nextPaginationToken) {
    const next = await googlePlayReviews({
        appId: 'com.google.android.apps.translate',
        sort: sort.NEWEST,
        paginate: true,
        nextPaginationToken: first.nextPaginationToken,
    });
    reviews_arr.push(next);
}


//filtering by score/rating
const angryUsers = await googlePlayReviews({
    appId: 'com.whatsapp',
    score: 1,
    num: 50,
});


const appReviews: ReviewResult[] = await appleStoreReviews({
    id: 479516143,
    country: 'us',
    page: 1
});

console.log('\n--- Recent Reviews ---');
appReviews.slice(0, 3).forEach((rev) => {
    console.log(`[★ ${rev.score}] ${rev.title} - ${rev.text}`);
});

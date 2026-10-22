import { NextResponse } from 'next/server';
import { getAuthenticatedProfile } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const result = await getAuthenticatedProfile();
    if (!result) return NextResponse.json({ user: null });
    return NextResponse.json({ user: { ...result.profile, email: result.profile.email ?? '' } });
  } catch (error) {
    console.error('Could not load the signed-in profile.', error);
    return NextResponse.json({ error: 'Could not load your account profile.' }, { status: 500 });
  }
}

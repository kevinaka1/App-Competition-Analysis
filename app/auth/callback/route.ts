import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const nextPath = request.nextUrl.searchParams.get('next') || '/?view=explore';
  const safePath = nextPath.startsWith('/') && !nextPath.startsWith('//') ? nextPath : '/?view=explore';
  if (code) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(safePath, request.url));
  }
  return NextResponse.redirect(new URL('/login?error=oauth', request.url));
}

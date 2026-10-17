import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function DELETE(request: NextRequest) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
  }

  if (typeof payload !== 'object' || payload === null) {
    return NextResponse.json({ error: 'Request body must include ideaId and userId.' }, { status: 400 });
  }

  const body = payload as Record<string, unknown>;
  const ideaId = typeof body.ideaId === 'string' ? body.ideaId.trim() : '';
  const userId = typeof body.userId === 'string' ? body.userId.trim() : '';
  if (!uuidPattern.test(ideaId)) return NextResponse.json({ error: 'A valid ideaId UUID is required.' }, { status: 400 });
  if (!uuidPattern.test(userId)) return NextResponse.json({ error: 'A valid userId UUID is required.' }, { status: 400 });

  try {
    const { data, error } = await getSupabase()
      .from('ideas')
      .delete()
      .eq('id', ideaId)
      .eq('user_id', userId)
      .select('id')
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: 'The idea was not found for this user.' }, { status: 404 });
    return NextResponse.json({ deleted: true, ideaId: data.id });
  } catch (error) {
    console.error('Could not delete the selected idea from Supabase.', error);
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23503') {
      return NextResponse.json({
        error: 'This idea still has saved analyses. Apply the migration supabase/migrations/20261016000000_cascade_delete_analyses_with_idea.sql in Supabase, then try again.',
      }, { status: 409 });
    }
    return NextResponse.json({ error: 'Could not delete this idea. Please try again.' }, { status: 500 });
  }
}

import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: doc, error: docError } = await supabase
    .from('documents')
    .select('storage_path, project_id, file_name, mime_type')
    .eq('id', params.id)
    .single()

  if (docError || !doc?.storage_path) {
    return NextResponse.json({ error: 'Document not found' }, { status: 404 })
  }

  // Create a signed URL valid for 60 seconds
  const { data, error } = await supabase.storage
    .from('documents')
    .createSignedUrl(doc.storage_path, 60, {
      download: false,
    })

  if (error || !data?.signedUrl) {
    return NextResponse.json({ error: 'Could not generate download link' }, { status: 500 })
  }

  return NextResponse.redirect(data.signedUrl)
}

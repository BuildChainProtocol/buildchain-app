import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const supabase = createClient()
  const { searchParams } = new URL(request.url)
  const projectId = searchParams.get('project_id')

  let query = supabase.from('documents').select('*').order('created_at')
  if (projectId) query = query.eq('project_id', projectId)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ data })
}

export async function POST(request: NextRequest) {
  const supabase = createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const formData = await request.formData()
  const file = formData.get('file') as File
  const projectId = formData.get('project_id') as string
  const documentId = formData.get('document_id') as string
  const docType = formData.get('doc_type') as string

  if (!file || !projectId) {
    return NextResponse.json({ error: 'Missing file or project_id' }, { status: 400 })
  }

  // Upload to Supabase Storage
  const fileName = `${projectId}/${Date.now()}-${file.name}`
  const { data: uploadData, error: uploadError } = await supabase.storage
    .from('documents')
    .upload(fileName, file, { contentType: file.type })

  if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 400 })

  // Update or create document record
  if (documentId) {
    const { data, error } = await supabase
      .from('documents')
      .update({
        storage_path: uploadData.path,
        file_name: file.name,
        file_size: file.size,
        mime_type: file.type,
        status: 'uploaded',
        uploaded_by: user.id,
        uploaded_at: new Date().toISOString(),
      })
      .eq('id', documentId)
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ data })
  } else {
    const { data, error } = await supabase
      .from('documents')
      .insert({
        project_id: projectId,
        doc_type: docType,
        name: file.name,
        storage_path: uploadData.path,
        file_name: file.name,
        file_size: file.size,
        mime_type: file.type,
        status: 'uploaded',
        uploaded_by: user.id,
        uploaded_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ data }, { status: 201 })
  }
}

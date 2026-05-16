import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { company_id, company_name } = await req.json()

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const bucketName = `company-${company_id}`

    // Create the bucket
    const { error: bucketError } = await supabaseAdmin.storage.createBucket(bucketName, {
      public: false,
      fileSizeLimit: 1099511627776, // 1TB default
      allowedMimeTypes: [
        'image/*',
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.dwg',
        'application/octet-stream',
        'video/*',
      ]
    })

    if (bucketError && !bucketError.message.includes('already exists')) {
      throw bucketError
    }

    // Store bucket name in companies table
    await supabaseAdmin
      .from('companies')
      .update({ storage_bucket: bucketName })
      .eq('id', company_id)

    return new Response(
      JSON.stringify({ success: true, bucket: bucketName }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error: any) {
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  }
})
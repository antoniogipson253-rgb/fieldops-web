import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function getWeekRange(weekOffset: number) {
  const now = new Date()
  const dayOfWeek = now.getDay()
  const monday = new Date(now)
  monday.setDate(now.getDate() - ((dayOfWeek + 6) % 7) + weekOffset * 7)
  monday.setHours(0, 0, 0, 0)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  sunday.setHours(23, 59, 59, 999)
  return { start: monday, end: sunday }
}

function minutesToHours(minutes: number) {
  return Math.round((minutes / 60) * 100) / 100
}

function buildExcelXml(rows: any[], weekLabel: string, companyName: string) {
  const headerRow = `
    <Row>
      <Cell ss:StyleID="header"><Data ss:Type="String">Employee</Data></Cell>
      <Cell ss:StyleID="header"><Data ss:Type="String">Date</Data></Cell>
      <Cell ss:StyleID="header"><Data ss:Type="String">Clock In</Data></Cell>
      <Cell ss:StyleID="header"><Data ss:Type="String">Clock Out</Data></Cell>
      <Cell ss:StyleID="header"><Data ss:Type="String">Hours</Data></Cell>
      <Cell ss:StyleID="header"><Data ss:Type="String">Project</Data></Cell>
      <Cell ss:StyleID="header"><Data ss:Type="String">Notes</Data></Cell>
    </Row>`

  const dataRows = rows.map((r) => `
    <Row>
      <Cell><Data ss:Type="String">${r.employee}</Data></Cell>
      <Cell><Data ss:Type="String">${r.date}</Data></Cell>
      <Cell><Data ss:Type="String">${r.clockIn}</Data></Cell>
      <Cell><Data ss:Type="String">${r.clockOut}</Data></Cell>
      <Cell><Data ss:Type="Number">${r.hours}</Data></Cell>
      <Cell><Data ss:Type="String">${r.project}</Data></Cell>
      <Cell><Data ss:Type="String">${r.notes}</Data></Cell>
    </Row>`).join('')

  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Styles>
    <Style ss:ID="header">
      <Font ss:Bold="1"/>
      <Interior ss:Color="#F97316" ss:Pattern="Solid"/>
    </Style>
  </Styles>
  <Worksheet ss:Name="Timesheet">
    <Table>
      <Row>
        <Cell ss:MergeAcross="6"><Data ss:Type="String">${companyName} — Timesheet for ${weekLabel}</Data></Cell>
      </Row>
      <Row/>
      ${headerRow}
      ${dataRows}
    </Table>
  </Worksheet>
</Workbook>`
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { recipientEmail, companyId, weekOffset = -1 } = await req.json()

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { start, end } = getWeekRange(weekOffset)
    const weekLabel = `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`

    const { data: company } = await supabaseAdmin
      .from('companies')
      .select('name')
      .eq('id', companyId)
      .single()

    const companyName = company?.name ?? 'FieldOps'

    const { data: entries, error } = await supabaseAdmin
      .from('time_entries')
      .select(`
        *,
        profile:user_id (full_name),
        project:project_id (name)
      `)
      .eq('company_id', companyId)
      .gte('clock_in', start.toISOString())
      .lte('clock_in', end.toISOString())
      .not('clock_out', 'is', null)
      .order('clock_in', { ascending: true })

    if (error) throw error

    const rows = (entries ?? []).map((e: any) => ({
      employee: e.profile?.full_name ?? 'Unknown',
      date: new Date(e.clock_in).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
      clockIn: new Date(e.clock_in).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }),
      clockOut: e.clock_out ? new Date(e.clock_out).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }) : '—',
      hours: minutesToHours(e.total_minutes ?? 0),
      project: e.project?.name ?? '—',
      notes: e.notes ?? '',
    }))

    const summary: Record<string, number> = {}
    for (const e of entries ?? []) {
      const name = (e as any).profile?.full_name ?? 'Unknown'
      summary[name] = (summary[name] ?? 0) + ((e as any).total_minutes ?? 0)
    }

    const excelXml = buildExcelXml(rows, weekLabel, companyName)
    const base64Excel = btoa(unescape(encodeURIComponent(excelXml)))

    const summaryHtml = Object.entries(summary)
      .map(([name, mins]) => `<tr><td style="padding:8px 16px;border-bottom:1px solid #1F2937;">${name}</td><td style="padding:8px 16px;border-bottom:1px solid #1F2937;text-align:right;">${minutesToHours(mins)}h</td></tr>`)
      .join('')

    const resendKey = Deno.env.get('RESEND_API_KEY')
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'FieldOps <fieldops.pro1@gmail.com>',
        to: recipientEmail,
        subject: `${companyName} — Timesheet ${weekLabel}`,
        html: `
          <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:32px;background:#0A0F1E;color:#FFFFFF;border-radius:16px;">
            <h1 style="color:#F97316;font-size:24px;letter-spacing:4px;margin-bottom:4px;">FIELDOPS</h1>
            <p style="color:#6B7280;font-size:13px;margin-bottom:32px;">PAYROLL REPORT</p>
            <h2 style="font-size:18px;margin-bottom:4px;">${companyName}</h2>
            <p style="color:#6B7280;font-size:14px;margin-bottom:24px;">Week of ${weekLabel}</p>
            <table style="width:100%;border-collapse:collapse;background:#111827;border-radius:10px;overflow:hidden;margin-bottom:24px;">
              <thead>
                <tr style="background:#F97316;">
                  <th style="padding:10px 16px;text-align:left;font-size:13px;">Employee</th>
                  <th style="padding:10px 16px;text-align:right;font-size:13px;">Total Hours</th>
                </tr>
              </thead>
              <tbody>${summaryHtml}</tbody>
            </table>
            <p style="color:#6B7280;font-size:12px;">Full timesheet attached as Excel file.</p>
          </div>
        `,
        attachments: [
          {
            filename: `timesheet-${weekLabel.replace(/[^a-z0-9]/gi, '-')}.xls`,
            content: base64Excel,
            type: 'application/vnd.ms-excel',
            disposition: 'attachment',
          }
        ],
      }),
    })

    return new Response(
      JSON.stringify({ success: true, week: weekLabel, entries: rows.length }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error: any) {
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  }
})
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

function toBase64(str: string): string {
  const encoder = new TextEncoder()
  const bytes = encoder.encode(str)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

function buildExcelXml(rows: any[], weekLabel: string, companyName: string) {
  const headerRow = `
    <Row>
      <Cell ss:StyleID="header"><Data ss:Type="String">Employee</Data></Cell>
      <Cell ss:StyleID="header"><Data ss:Type="String">Date</Data></Cell>
      <Cell ss:StyleID="header"><Data ss:Type="String">Clock In</Data></Cell>
      <Cell ss:StyleID="header"><Data ss:Type="String">Clock Out</Data></Cell>
      <Cell ss:StyleID="header"><Data ss:Type="String">Raw Hours</Data></Cell>
      <Cell ss:StyleID="header"><Data ss:Type="String">Lunch Deduction</Data></Cell>
      <Cell ss:StyleID="header"><Data ss:Type="String">Net Hours</Data></Cell>
      <Cell ss:StyleID="header"><Data ss:Type="String">OT</Data></Cell>
      <Cell ss:StyleID="header"><Data ss:Type="String">Flag</Data></Cell>
      <Cell ss:StyleID="header"><Data ss:Type="String">Project</Data></Cell>
    </Row>`

  const dataRows = rows.map((r) => `
    <Row>
      <Cell><Data ss:Type="String">${r.employee}</Data></Cell>
      <Cell><Data ss:Type="String">${r.date}</Data></Cell>
      <Cell><Data ss:Type="String">${r.clockIn}</Data></Cell>
      <Cell><Data ss:Type="String">${r.isMissingClockOut ? 'MISSING' : r.clockOut}</Data></Cell>
      <Cell><Data ss:Type="${r.isMissingClockOut ? 'String' : 'Number'}">${r.isMissingClockOut ? '—' : r.rawHours}</Data></Cell>
      <Cell><Data ss:Type="${r.isMissingClockOut ? 'String' : 'Number'}">${r.isMissingClockOut ? '—' : r.lunchDeduction}</Data></Cell>
      <Cell><Data ss:Type="${r.isMissingClockOut ? 'String' : 'Number'}">${r.isMissingClockOut ? '—' : r.netHours}</Data></Cell>
      <Cell><Data ss:Type="String">${r.overtime}</Data></Cell>
      <Cell><Data ss:Type="String">${r.flag}</Data></Cell>
      <Cell><Data ss:Type="String">${r.project}</Data></Cell>
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
        <Cell ss:MergeAcross="9"><Data ss:Type="String">${companyName} — Timesheet for ${weekLabel}</Data></Cell>
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

    console.log('Starting payroll report for company:', companyId)
    console.log('Recipient:', recipientEmail)
    console.log('RESEND_API_KEY exists:', !!Deno.env.get('RESEND_API_KEY'))

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const { start, end } = getWeekRange(weekOffset)
    const weekLabel = `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Chicago' })} – ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Chicago' })}`

    const { data: company } = await supabaseAdmin
      .from('companies')
      .select('name')
      .eq('id', companyId)
      .single()

    const companyName = company?.name ?? 'FieldOps'

    const { data: entries, error } = await supabaseAdmin
      .from('time_entries')
      .select('*, project:project_id (name, lunch_break_minutes)')
      .eq('company_id', companyId)
      .gte('clock_in', start.toISOString())
      .lte('clock_in', end.toISOString())
      .order('clock_in', { ascending: true })

    if (error) throw error

    console.log('Entries found:', entries?.length ?? 0)

    const userIds = [...new Set((entries ?? []).map((e: any) => e.user_id))]
    const { data: profiles } = await supabaseAdmin
      .from('profiles')
      .select('id, full_name')
      .in('id', userIds.length > 0 ? userIds : ['00000000-0000-0000-0000-000000000000'])

    const profileMap: Record<string, string> = {}
    for (const p of profiles ?? []) {
      profileMap[p.id] = p.full_name ?? 'Unknown'
    }

    const rows = (entries ?? []).map((e: any) => {
      const isMissingClockOut = !e.clock_out
      const rawMinutes = e.total_minutes ?? 0
      const lunchBreakMinutes = (e.project as any)?.lunch_break_minutes ?? 0
      const lunchMinutes = rawMinutes > 0 && lunchBreakMinutes > 0 ? lunchBreakMinutes : 0
      const netMinutes = Math.max(0, rawMinutes - lunchMinutes)
      const netHours = minutesToHours(netMinutes)

      return {
        employee: profileMap[e.user_id] ?? 'Unknown',
        date: new Date(e.clock_in).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/Chicago' }),
        clockIn: new Date(e.clock_in).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Chicago' }),
        clockOut: e.clock_out ? new Date(e.clock_out).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Chicago' }) : '—',
        isMissingClockOut,
        rawHours: minutesToHours(rawMinutes),
        lunchDeduction: lunchMinutes > 0 ? -minutesToHours(lunchMinutes) : 0,
        netHours,
        netMinutes,
        overtime: netHours > 8 ? 'OT' : '',
        flag: isMissingClockOut ? 'Missing clock-out' : (e.flagged ? (e.flag_reason ?? 'Flagged') : ''),
        project: (e.project as any)?.name ?? '—',
      }
    })

    const summary: Record<string, number> = {}
    for (const r of rows) {
      summary[r.employee] = (summary[r.employee] ?? 0) + r.netMinutes
    }

    const excelXml = buildExcelXml(rows, weekLabel, companyName)
    const base64Excel = toBase64(excelXml)

    const summaryHtml = Object.entries(summary)
      .map(([name, mins]) => `<tr><td style="padding:8px 16px;border-bottom:1px solid #1F2937;">${name}</td><td style="padding:8px 16px;border-bottom:1px solid #1F2937;text-align:right;">${minutesToHours(mins)}h</td></tr>`)
      .join('')

    const detailHtml = rows.map((r) => `
      <tr>
        <td style="padding:6px 10px;border-bottom:1px solid #1F2937;">${r.employee}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #1F2937;">${r.date}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #1F2937;">${r.clockIn}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #1F2937;${r.isMissingClockOut ? 'color:#EF4444;font-weight:700;' : ''}">${r.isMissingClockOut ? 'MISSING' : r.clockOut}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #1F2937;text-align:right;">${r.isMissingClockOut ? '—' : `${r.rawHours.toFixed(2)}h`}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #1F2937;text-align:right;color:${r.lunchDeduction < 0 ? '#EF4444' : '#6B7280'};">${r.isMissingClockOut ? '—' : (r.lunchDeduction === 0 ? '0h' : `${r.lunchDeduction.toFixed(2)}h`)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #1F2937;text-align:right;font-weight:700;">${r.isMissingClockOut ? '—' : `${r.netHours.toFixed(2)}h`}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #1F2937;text-align:center;color:#F97316;font-weight:700;">${r.overtime}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #1F2937;color:#EF4444;">${r.flag}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #1F2937;">${r.project}</td>
      </tr>`).join('')

    const flaggedRows = rows.filter((r) => r.flag)

    const flaggedHtml = flaggedRows.length > 0 ? `
      <h3 style="font-size:15px;color:#FCA5A5;margin-bottom:12px;">⚠ Flagged Entries</h3>
      <table style="width:100%;border-collapse:collapse;margin-bottom:24px;border-radius:10px;overflow:hidden;">
        <tbody>
          ${flaggedRows.map((r) => `
            <tr style="background:${r.isMissingClockOut ? '#92400E' : '#7F1D1D'};">
              <td style="padding:8px 14px;font-weight:700;color:${r.isMissingClockOut ? '#FCD34D' : '#FCA5A5'};">${r.employee}</td>
              <td style="padding:8px 14px;color:${r.isMissingClockOut ? '#FCD34D' : '#FCA5A5'};">${r.date}</td>
              <td style="padding:8px 14px;color:${r.isMissingClockOut ? '#FCD34D' : '#FCA5A5'};">${r.flag}</td>
              <td style="padding:8px 14px;color:${r.isMissingClockOut ? '#FCD34D' : '#FCA5A5'};">${r.clockIn}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    ` : ''

    console.log('Sending email via Resend...')

    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'FieldOps Pro <noreply@mail.fieldopspro.org>',
        to: recipientEmail,
        subject: `${companyName} — Timesheet ${weekLabel}`,
        html: `
          <div style="font-family:sans-serif;max-width:900px;margin:0 auto;padding:32px;background:#0A0F1E;color:#FFFFFF;border-radius:16px;">
            <h1 style="color:#F97316;font-size:24px;letter-spacing:4px;margin-bottom:4px;">FIELDOPS</h1>
            <p style="color:#6B7280;font-size:13px;margin-bottom:32px;">PAYROLL REPORT</p>
            <h2 style="font-size:18px;margin-bottom:4px;">${companyName}</h2>
            <p style="color:#6B7280;font-size:14px;margin-bottom:24px;">Week of ${weekLabel}</p>

            <table style="width:100%;border-collapse:collapse;background:#111827;border-radius:10px;overflow:hidden;margin-bottom:24px;">
              <thead>
                <tr style="background:#F97316;">
                  <th style="padding:10px 16px;text-align:left;font-size:13px;color:#0A0F1E;">Employee</th>
                  <th style="padding:10px 16px;text-align:right;font-size:13px;color:#0A0F1E;">Total Net Hours</th>
                </tr>
              </thead>
              <tbody>${summaryHtml}</tbody>
            </table>

            ${flaggedHtml}

            <h3 style="font-size:15px;color:#9CA3AF;margin-bottom:12px;">Detail</h3>
            <div style="overflow-x:auto;">
              <table style="width:100%;border-collapse:collapse;background:#111827;border-radius:10px;font-size:12px;">
                <thead>
                  <tr style="background:#1F2937;">
                    <th style="padding:8px 10px;text-align:left;color:#9CA3AF;">Employee</th>
                    <th style="padding:8px 10px;text-align:left;color:#9CA3AF;">Date</th>
                    <th style="padding:8px 10px;text-align:left;color:#9CA3AF;">Clock In</th>
                    <th style="padding:8px 10px;text-align:left;color:#9CA3AF;">Clock Out</th>
                    <th style="padding:8px 10px;text-align:right;color:#9CA3AF;">Raw</th>
                    <th style="padding:8px 10px;text-align:right;color:#9CA3AF;">Lunch</th>
                    <th style="padding:8px 10px;text-align:right;color:#9CA3AF;">Net</th>
                    <th style="padding:8px 10px;text-align:center;color:#9CA3AF;">OT</th>
                    <th style="padding:8px 10px;text-align:left;color:#9CA3AF;">Flag</th>
                    <th style="padding:8px 10px;text-align:left;color:#9CA3AF;">Project</th>
                  </tr>
                </thead>
                <tbody>${detailHtml}</tbody>
              </table>
            </div>

            <p style="color:#6B7280;font-size:12px;margin-top:24px;">Full timesheet also attached as Excel file.</p>
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

    const emailResult = await emailRes.json()
    console.log('Resend status:', emailRes.status)
    console.log('Resend result:', JSON.stringify(emailResult))

    if (!emailRes.ok) throw new Error(JSON.stringify(emailResult))

    return new Response(
      JSON.stringify({ success: true, week: weekLabel, entries: rows.length }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error: any) {
    console.error('Error:', error.message)
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
    )
  }
})

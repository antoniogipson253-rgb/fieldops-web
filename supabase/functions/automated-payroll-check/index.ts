import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Get current time in US Central (Texas) time
    const now = new Date();
    const centralTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
    const currentDay = centralTime.getDay();     // 0=Sun, 1=Mon, ..., 6=Sat
    const currentHour = centralTime.getHours();
    const currentMinute = centralTime.getMinutes();

    console.log(`Checking schedule at Central Time: Day=${currentDay} Hour=${currentHour} Minute=${currentMinute}`);

    // Fetch all enabled payroll schedules
    const { data: schedules, error } = await supabase
      .from('payroll_settings')
      .select('*')
      .eq('enabled', true);

    if (error) throw error;
    if (!schedules || schedules.length === 0) {
      return new Response(JSON.stringify({ message: 'No enabled schedules found' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Found ${schedules.length} enabled schedule(s)`);

    const results = [];

    for (const schedule of schedules) {
      // Check if current time matches this company's schedule
      // Allow a 14-minute window since cron runs every 15 min
      const dayMatches = schedule.schedule_day === currentDay;
      const hourMatches = schedule.schedule_hour === currentHour;
      const minuteMatches = Math.abs(schedule.schedule_minute - currentMinute) <= 14;

      console.log(`Company ${schedule.company_id}: dayMatches=${dayMatches} hourMatches=${hourMatches} minuteMatches=${minuteMatches}`);

      if (!dayMatches || !hourMatches || !minuteMatches) {
        results.push({ company_id: schedule.company_id, status: 'skipped' });
        continue;
      }

      // For biweekly — check if this is an "on" week
      if (schedule.frequency === 'biweekly') {
        const weekNumber = Math.floor(
          (centralTime.getTime() - new Date('2024-01-01').getTime()) / (7 * 24 * 60 * 60 * 1000)
        );
        if (weekNumber % 2 !== 0) {
          results.push({ company_id: schedule.company_id, status: 'skipped_biweekly' });
          continue;
        }
      }

      // Fire the payroll report
      console.log(`Sending payroll report for company ${schedule.company_id} to ${schedule.recipient_email}`);

      try {
        const res = await fetch(
          `${Deno.env.get('SUPABASE_URL')}/functions/v1/send-payroll-report`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
            },
            body: JSON.stringify({
              recipientEmail: schedule.recipient_email,
              companyId: schedule.company_id,
              weekOffset: -1, // Always last week for automated reports
            }),
          }
        );

        const result = await res.json();

        if (!res.ok) throw new Error(result.error ?? 'Send failed');

        // Log the send
        await supabase.from('payroll_send_log').insert({
          company_id: schedule.company_id,
          recipient_email: schedule.recipient_email,
          sent_at: new Date().toISOString(),
          status: 'success',
          week_label: result.week,
        }).then(() => {}).catch(() => {}); // Non-fatal if log fails

        results.push({ company_id: schedule.company_id, status: 'sent', week: result.week });
        console.log(`Successfully sent for company ${schedule.company_id}`);

      } catch (sendError: any) {
        console.error(`Failed to send for company ${schedule.company_id}:`, sendError.message);
        results.push({ company_id: schedule.company_id, status: 'failed', error: sendError.message });
      }
    }

    return new Response(JSON.stringify({ success: true, results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err: any) {
    console.error('Automated payroll check error:', err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
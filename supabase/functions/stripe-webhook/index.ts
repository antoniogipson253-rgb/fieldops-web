import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@12'

const PLAN_MAP: Record<string, { plan: string; max_members: number }> = {
  'price_1TXScSDmd1wcZvf6j7URtxhK': { plan: 'field', max_members: 10 },
  'price_1TXSeADmd1wcZvf6GteMGf9L': { plan: 'crew', max_members: 40 },
  'price_1TXSfGDmd1wcZvf6Bv74UzZ8': { plan: 'project', max_members: 120 },
}

serve(async (req) => {
  try {
    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') ?? '', {
      apiVersion: '2023-10-16',
    })

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const signature = req.headers.get('stripe-signature')
    const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET') ?? ''
    const body = await req.text()

    let event
    try {
      event = await stripe.webhooks.constructEventAsync(body, signature ?? '', webhookSecret)
    } catch (err: any) {
      return new Response(`Webhook error: ${err.message}`, { status: 400 })
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as any
      const userId = session.metadata?.user_id
      const priceId = session.line_items?.data?.[0]?.price?.id

      if (userId) {
        // Update profile to subscribed
        await supabaseAdmin
          .from('profiles')
          .update({ is_subscribed: true })
          .eq('id', userId)

        // Get the price ID from the session line items
        const fullSession = await stripe.checkout.sessions.retrieve(session.id, {
          expand: ['line_items'],
        })
        const paidPriceId = fullSession.line_items?.data?.[0]?.price?.id ?? ''
        const planInfo = PLAN_MAP[paidPriceId]

        if (planInfo) {
          // Find user's company and update plan + member limit
          const { data: profile } = await supabaseAdmin
            .from('profiles')
            .select('company_id')
            .eq('id', userId)
            .single()

          if (profile?.company_id) {
            await supabaseAdmin
              .from('companies')
              .update({
                plan: planInfo.plan,
                max_members: planInfo.max_members,
              })
              .eq('id', profile.company_id)
          }
        }
      }
    }

    if (event.type === 'customer.subscription.deleted') {
      const subscription = event.data.object as any
      const customerId = subscription.customer

      const { data: profiles } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .eq('stripe_customer_id', customerId)

      if (profiles && profiles.length > 0) {
        await supabaseAdmin
          .from('profiles')
          .update({ is_subscribed: false })
          .eq('stripe_customer_id', customerId)
      }
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { 'Content-Type': 'application/json' },
    })

  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400 }
    )
  }
})
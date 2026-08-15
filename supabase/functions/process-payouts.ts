import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret'
};

async function isAdminUser(supabaseUrl: string, serviceRoleKey: string, token: string) {
  const adminClient = createClient(supabaseUrl, serviceRoleKey);
  const { data: authData } = await adminClient.auth.getUser(token);
  const userId = authData.user?.id;

  if (!userId) {
    return false;
  }

  const { data: profile } = await adminClient
    .from('users')
    .select('role, status')
    .eq('id', userId)
    .single();

  return profile?.role === 'admin' && profile?.status === 'active';
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const cronSecret = Deno.env.get('PAYOUT_CRON_SECRET') ?? '';
    const requestCronSecret = request.headers.get('x-cron-secret') ?? '';
    const authorization = request.headers.get('Authorization')?.replace('Bearer ', '') ?? '';

    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(JSON.stringify({ error: 'Missing Supabase function configuration.' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const cronAuthorized = cronSecret && requestCronSecret && cronSecret === requestCronSecret;
    const adminAuthorized = authorization && await isAdminUser(supabaseUrl, serviceRoleKey, authorization);

    if (!cronAuthorized && !adminAuthorized) {
      return new Response(JSON.stringify({ error: 'Unauthorized payout request.' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data, error } = await adminClient.rpc('process_due_cycles');
    if (error) throw error;

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message || 'Payout processing failed.' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

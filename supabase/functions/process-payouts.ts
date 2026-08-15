import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

function buildCorsHeaders(origin: string) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret'
  };
}

function resolveAllowedOrigin(request: Request) {
  const configuredOrigin = Deno.env.get('APP_ORIGIN')?.trim() ?? '';
  const requestOrigin = request.headers.get('Origin')?.trim() ?? '';

  if (!configuredOrigin) {
    return '';
  }

  return requestOrigin === configuredOrigin ? requestOrigin : configuredOrigin;
}

function isDisallowedBrowserOrigin(request: Request) {
  const configuredOrigin = Deno.env.get('APP_ORIGIN')?.trim() ?? '';
  const requestOrigin = request.headers.get('Origin')?.trim() ?? '';

  return Boolean(configuredOrigin && requestOrigin && requestOrigin !== configuredOrigin);
}

async function timingSafeEqual(left: string, right: string) {
  const encoder = new TextEncoder();
  const leftDigest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(left)));
  const rightDigest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(right)));

  let mismatch = leftDigest.length === rightDigest.length ? 0 : 1;
  const comparisonLength = Math.max(leftDigest.length, rightDigest.length);

  for (let index = 0; index < comparisonLength; index += 1) {
    mismatch |= (leftDigest[index] ?? 0) ^ (rightDigest[index] ?? 0);
  }

  return mismatch === 0;
}

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
  const corsHeaders = buildCorsHeaders(resolveAllowedOrigin(request));

  if (isDisallowedBrowserOrigin(request)) {
    return new Response(JSON.stringify({ error: 'Origin not allowed.' }), {
      status: 403,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

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

    const cronAuthorized = Boolean(
      cronSecret &&
      requestCronSecret &&
      await timingSafeEqual(cronSecret, requestCronSecret)
    );
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

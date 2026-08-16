import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

function buildCorsHeaders(origin: string) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
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
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const authorization = request.headers.get('Authorization') ?? '';

    if (!supabaseUrl || !supabaseAnonKey || !authorization) {
      return new Response(JSON.stringify({ error: 'Missing Supabase function configuration or auth token.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const client = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: authorization
        }
      }
    });

    const { data: authData, error: authError } = await client.auth.getUser();
    if (authError || !authData.user) {
      return new Response(JSON.stringify({ error: 'Unauthorized request.' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const body = await request.json();

    if (body.action === 'request') {
      const { data, error } = await client.rpc('create_withdrawal_request', {
        p_amount: Number(body.amount),
        p_wallet_address: body.walletAddress ?? null,
        p_network_type: body.networkType ?? null
      });

      if (error) throw error;
      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (body.action === 'review') {
      const { data, error } = await client.rpc('process_withdrawal_request', {
        p_withdrawal_id: body.withdrawalId,
        p_status: body.status,
        p_notes: body.notes ?? null
      });

      if (error) throw error;
      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ error: 'Unsupported withdrawal action.' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message || 'Withdrawal processing failed.' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

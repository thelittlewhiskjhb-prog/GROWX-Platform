// Supabase Edge Function: admin-allocate-package
// Admin allocates a package to a client.
// Package amount is read server-side — never trusted from browser.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey     = Deno.env.get('SUPABASE_ANON_KEY');

  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }
  });

  const serviceClient = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  try {
    const { data: { user }, error: userError } = await authClient.auth.getUser();
    if (userError || !user) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const { data: profile } = await serviceClient
      .from('users').select('role').eq('id', user.id).single();

    if (profile?.role !== 'admin') {
      return jsonResponse({ error: 'Forbidden' }, 403);
    }

    const { clientUserId, packageId } = await req.json();

    if (!clientUserId || !packageId) {
      return jsonResponse({ error: 'clientUserId and packageId are required' }, 400);
    }

    const { data: result, error: rpcError } = await serviceClient
      .rpc('admin_allocate_package', { p_user_id: clientUserId, p_package_id: packageId });

    if (rpcError) {
      return jsonResponse({ error: rpcError.message }, 400);
    }

    return jsonResponse({ success: true, userPackageId: result });

  } catch (err) {
    console.error('admin-allocate-package error:', err);
    return jsonResponse({ error: 'Internal server error' }, 500);
  }
});

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

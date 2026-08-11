import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

console.log('--- SUPABASE END-TO-END SERVICE TEST ---');
console.log('URL:', supabaseUrl);
console.log('Anon Key present:', !!supabaseAnonKey);

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing Supabase credentials in .env!');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function runTests() {
  const results = {
    auth: false,
    tables: {},
    rpcs: {},
    storage: {},
    edgeFunctions: {},
    errors: []
  };

  // 1. Test Auth Service Connection
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      console.error('Auth getSession error:', error.message);
      results.errors.push(`Auth getSession: ${error.message}`);
    } else {
      console.log('✅ Auth service reachable. Current session:', data.session ? 'Active' : 'No active session (clean state)');
      results.auth = true;
    }
  } catch (err) {
    console.error('Auth test failed:', err);
    results.errors.push(`Auth exception: ${err.message}`);
  }

  // 2. Test Tables & Views accessibility via anon / RLS
  const tablesToTest = [
    'profiles',
    'public_profiles',
    'photos',
    'swipes',
    'matches',
    'messages',
    'reports',
    'blocks',
    'coin_ledger',
    'daily_picks',
    'push_tokens'
  ];

  for (const tbl of tablesToTest) {
    try {
      const { data, error, count } = await supabase.from(tbl).select('*', { count: 'exact', head: true });
      if (error) {
        // Some errors are expected due to RLS if unauthenticated (e.g. 401 or RLS policy denying select)
        console.log(`Table/View [${tbl}]: responded with status/error -> ${error.message} (code: ${error.code})`);
        results.tables[tbl] = { ok: true, status: error.message, code: error.code };
      } else {
        console.log(`✅ Table/View [${tbl}]: exists and accessible (row count check ok)`);
        results.tables[tbl] = { ok: true, accessible: true, count };
      }
    } catch (err) {
      console.log(`❌ Table/View [${tbl}]: exception -> ${err.message}`);
      results.tables[tbl] = { ok: false, error: err.message };
      results.errors.push(`Table ${tbl}: ${err.message}`);
    }
  }

  // 3. Test RPCs (Stored Procedures)
  const rpcsToTest = [
    { name: 'get_deck', params: { limit_count: 5 } },
    { name: 'get_daily_picks', params: {} },
    { name: 'get_likes_count', params: {} },
    { name: 'claim_daily_coins', params: {} }
  ];

  for (const rpc of rpcsToTest) {
    try {
      const { data, error } = await supabase.rpc(rpc.name, rpc.params);
      if (error) {
        console.log(`RPC [${rpc.name}]: error -> ${error.message} (code: ${error.code})`);
        results.rpcs[rpc.name] = { exists: error.code !== 'PGRST202', message: error.message, code: error.code };
      } else {
        console.log(`✅ RPC [${rpc.name}]: executed successfully`);
        results.rpcs[rpc.name] = { exists: true, ok: true, data };
      }
    } catch (err) {
      console.log(`❌ RPC [${rpc.name}]: exception -> ${err.message}`);
      results.rpcs[rpc.name] = { exists: false, error: err.message };
    }
  }

  // 4. Test Storage Bucket "photos"
  try {
    const { data: buckets, error: bError } = await supabase.storage.listBuckets();
    if (bError) {
      console.log(`Storage listBuckets: ${bError.message} (code: ${bError.code})`);
      results.storage.listBuckets = { ok: false, error: bError.message };
    } else {
      console.log('✅ Storage buckets:', buckets.map(b => b.name));
      results.storage.buckets = buckets.map(b => ({ name: b.name, public: b.public }));
    }

    // Test signed URL generation for a dummy path
    const { data: signedData, error: signedError } = await supabase.storage
      .from('photos')
      .createSignedUrl('test/dummy.jpg', 60);
    
    if (signedError) {
      console.log(`Storage signed URL test on 'photos' bucket: ${signedError.message}`);
      results.storage.photosBucket = { signedUrlTest: false, error: signedError.message };
    } else {
      console.log(`✅ Storage signed URL generated successfully for photos bucket`);
      results.storage.photosBucket = { signedUrlTest: true };
    }
  } catch (err) {
    console.error('Storage test exception:', err);
    results.storage.error = err.message;
  }

  // 5. Test Edge Functions (HTTP health / response)
  const edgeFunctionsToTest = [
    'embed-profile',
    'generate-profile',
    'likes-you',
    'verify-selfie',
    'notify-message',
    'delete-account'
  ];

  for (const fn of edgeFunctionsToTest) {
    try {
      const start = Date.now();
      const res = await fetch(`${supabaseUrl}/functions/v1/${fn}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseAnonKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ test: true })
      });
      const duration = Date.now() - start;
      const status = res.status;
      let text = '';
      try {
        text = await res.text();
      } catch (e) {}
      console.log(`Edge Function [${fn}]: HTTP ${status} in ${duration}ms -> ${text.slice(0, 100)}`);
      results.edgeFunctions[fn] = { status, text: text.slice(0, 100), duration };
    } catch (err) {
      console.log(`Edge Function [${fn}]: network error -> ${err.message}`);
      results.edgeFunctions[fn] = { error: err.message };
    }
  }

  console.log('\n--- TEST SUMMARY COMPLETED ---');
}

runTests().catch(console.error);

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_KEY env vars');
}

// Service Role Key allows us to write to DB without RLS rules
export const supabase = createClient(
    process.env.SUPABASE_URL, 
    process.env.SUPABASE_KEY
);

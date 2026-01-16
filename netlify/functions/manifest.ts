import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

export default async (req: Request) => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const supabaseKey = Deno.env.get('SUPABASE_KEY') ?? '' 
  const supabase = createClient(supabaseUrl, supabaseKey)

  try {
    // UPDATED: We now select 'category' and order by it
    const { data, error } = await supabase
      .from('feeds')
      .select('id, name, url, category')
      .order('category', { ascending: true })

    if (error) throw error

    return new Response(JSON.stringify(data), {
      headers: { 
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*" 
      },
      status: 200
    })

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      headers: { "Content-Type": "application/json" },
      status: 500
    })
  }
}
import type { APIRoute } from 'astro';

export const prerender = false;

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const data = await request.json();
    const { DB } = locals.runtime.env;

    await DB.prepare(`
      INSERT INTO access_requests (
        name, email, phone, website, company, role, use_case, category, timeline, message
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      data.name,
      data.email,
      data.phone,
      data.website,
      data.company,
      data.role,
      data['use-case'],
      data.category,
      data.timeline,
      data.message || ''
    ).run();

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Database error:', error);
    return new Response(JSON.stringify({ error: 'Failed to save request' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
import { getSupabaseAdmin, jsonResponse } from '../_shared/location.ts';

export function ticketResult(value: any) {
  const ticket = Array.isArray(value?.data) ? value.data[0] : value?.data;
  return { accepted: ticket?.status === 'ok' && typeof ticket.id === 'string', id: ticket?.id || null, retire: ticket?.details?.error === 'DeviceNotRegistered' };
}
export async function handler(req: Request) {
  const secret = Deno.env.get('PLANNING_CRON_SECRET');
  if (!secret || req.headers.get('x-planning-cron-secret') !== secret) return jsonResponse({ error: 'Unauthorized' }, 401);
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);
  const db = getSupabaseAdmin();
  let sent = 0, failed = 0;
  try {
    // Bounded retention, delivery receipts and retirement of invalid device tokens.
    await db.from('notification_events').delete().lt('created_at', new Date(Date.now() - 30 * 86400000).toISOString());
    await db.from('notification_events').update({ status: 'unknown' }).eq('status','sending').lt('sent_at',new Date(Date.now()-10*60000).toISOString());
    await db.from('notification_events').update({ status: 'cancelled' }).eq('status','pending').lt('expires_at',new Date().toISOString());
    const { data: receipts } = await db.from('notification_events').select('id,ticket_id,device_token,user_id').eq('status','accepted').lt('sent_at',new Date(Date.now()-15*60000).toISOString()).limit(50);
    if (receipts?.length) {
      const response = await fetch('https://exp.host/--/api/v2/push/getReceipts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: receipts.map((r: any) => r.ticket_id) }), signal: AbortSignal.timeout(6000) });
      if (response.ok) {
        const result = await response.json();
        for (const row of receipts) {
          const receipt = result.data?.[row.ticket_id];
          if (!receipt) continue;
          await db.from('notification_events').update({status:receipt.status==='ok'?'handed_off':'failed'}).eq('id',row.id);
          if (receipt.details?.error==='DeviceNotRegistered') await db.from('planning_push_devices').delete().eq('token',row.device_token).eq('user_id',row.user_id);
        }
      }
    }
    await db.from('notification_events').update({status:'unknown'}).eq('status','accepted').lt('sent_at',new Date(Date.now()-86400000).toISOString());
    const { data: events, error } = await db.from('notification_events').select('id').eq('status','pending').order('created_at').limit(50);
    if (error) throw error;
    const started = Date.now();
    for (const event of events || []) {
      if (Date.now()-started>35000) break;
      const { data: notice, error: claimError } = await db.rpc('claim_notification',{p_id:event.id});
      if (claimError) throw claimError;
      if (!notice) continue;
      // Check consent and token ownership again immediately before provider handoff.
      const { data: prefs } = await db.from('notification_preferences').select('linkup,plans').eq('user_id',notice.userId).single();
      const { data: device } = await db.from('planning_push_devices').select('token').eq('token',notice.token).eq('user_id',notice.userId).maybeSingle();
      if (!device || !(notice.kind==='plan_ready'?prefs?.plans:prefs?.linkup)) {
        await db.from('notification_events').update({status:'cancelled'}).eq('id',notice.id); continue;
      }
      try {
        const response = await fetch('https://exp.host/--/api/v2/push/send', {
          method:'POST', headers:{'Content-Type':'application/json'}, signal:AbortSignal.timeout(6000),
          body:JSON.stringify({to:notice.token,title:notice.title,body:notice.body,channelId:'planning',sound:'default',ttl:Math.max(1,Math.floor((new Date(notice.expiresAt).getTime()-Date.now())/1000)),data:{userId:notice.userId,eventId:notice.id,path:notice.path,kind:notice.kind}}),
        });
        const ticket = response.ok ? ticketResult(await response.json()) : {accepted:false,id:null,retire:false};
        const {error:writeError}=await db.from('notification_events').update({status:ticket.accepted?'accepted':'failed',ticket_id:ticket.id}).eq('id',notice.id);
        if(writeError) throw writeError;
        if(ticket.retire) await db.from('planning_push_devices').delete().eq('token',notice.token).eq('user_id',notice.userId);
        if(ticket.accepted) sent++; else failed++;
      } catch {
        await db.from('notification_events').update({status:'unknown'}).eq('id',notice.id); failed++;
      }
    }
    return jsonResponse({sent,failed});
  } catch { return jsonResponse({error:'Notification delivery failed',sent,failed},500); }
}
Deno.serve(handler);

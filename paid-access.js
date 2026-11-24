'use strict';

// Client-facing status only. All paid orders and account ownership are validated on Supabase.
// Github Pages hosts public client code; this UI gate is not a secure content paywall.
const diaryPaidState = {userId:null, verified:false, access:[], ownerAccess:false, error:''};

// The browser clock is NOT authoritative. A monotonic timer advances from the
// latest independently retrieved Supabase Edge Function time.
const diaryClock = {ready:false, serverMs:0, monotonicMs:0, lastSync:0, error:''};
function diaryTimeNow(){
  return diaryClock.ready ? diaryClock.serverMs + (performance.now() - diaryClock.monotonicMs) : NaN;
}
function diaryTrialActive(){
  const now = diaryTimeNow();
  return Number.isFinite(now) && now < config.cutoff;
}
async function diaryClockSync(){
  const started = performance.now();
  try {
    const response = await fetch(accountProjectUrl + '/functions/v1/diary-access-clock', {
      method:'GET', cache:'no-store', credentials:'omit', signal:AbortSignal.timeout(10000)
    });
    if (!response.ok) throw Error('Clock service unavailable');
    const payload = await response.json();
    const finished = performance.now();
    const serverMs = Date.parse(payload.server_now);
    if (!Number.isFinite(serverMs) || payload.trial_ends_at !== '2027-01-01T00:00:00+03:00') {
      throw Error('Invalid clock response');
    }
    diaryClock.serverMs = serverMs + (finished - started) / 2;
    diaryClock.monotonicMs = finished;
    diaryClock.lastSync = finished;
    diaryClock.ready = true;
    diaryClock.error = '';
  } catch {
    // Keep the last trustworthy monotonic clock; never fall back to Date.now().
    diaryClock.error = 'unavailable';
  }
  const status = document.getElementById('diaryTimeStatus');
  if (status) {
    status.textContent = !diaryClock.ready
      ? 'Не удалось проверить срок доступа через сервер. Записи сохранены в браузере. Попробуйте повторить проверку.'
      : '';
    status.hidden = diaryClock.ready;
  }
  if (typeof closeExpiredTrial === 'function') closeExpiredTrial();
  diaryPaidRender();
  return diaryClock.ready;
}
function diaryPaidActive(){
  if(!diaryPaidState.verified || !diaryPaidState.userId) return false;
  if(typeof accountOwner === 'undefined' || accountOwner !== diaryPaidState.userId) return false;
  if(typeof verifiedAccount === 'undefined' || verifiedAccount?.id !== diaryPaidState.userId) return false;
  const now=diaryTimeNow();
  if (!Number.isFinite(now)) return false;
  if (diaryPaidState.ownerAccess) return true;
  return diaryPaidState.access.some(item=>Date.parse(item.starts_at)<=now && now<Date.parse(item.ends_at));
}
function diaryPaidDate(value){
  const d=new Date(value);
  if(!Number.isFinite(d.getTime())) return 'не определена';
  return new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',year:'numeric',timeZone:'Europe/Moscow'}).format(d);
}
function diaryPaidRender(){
  const status=document.getElementById('accountAccessStatus');
  const refresh=document.getElementById('refreshPaidAccess');
  if(!status || !refresh) return;
  const lockedMessage=document.getElementById('paidLockMessage');
  if(!diaryPaidState.userId){
    status.textContent='';refresh.hidden=true;
    if(lockedMessage) lockedMessage.textContent='Войдите в зарегистрированный аккаунт с подтверждённой электронной почтой. После проверки оплаты дневник откроется на приобретённый срок.';
    return;
  }
  refresh.hidden=false;
  const now=diaryTimeNow();
  if (diaryPaidState.ownerAccess) {
    status.textContent='Вы вошли как владелец дневника. Доступ бессрочный.';
    return;
  }
  const current=diaryPaidState.access.filter(e=>Date.parse(e.starts_at)<=now && now<Date.parse(e.ends_at))
    .sort((a,b)=>Date.parse(b.ends_at)-Date.parse(a.ends_at))[0];
  const future=diaryPaidState.access.filter(e=>Date.parse(e.starts_at)>now)
    .sort((a,b)=>Date.parse(a.starts_at)-Date.parse(b.starts_at))[0];
  if(diaryPaidState.error) status.textContent='Проверка оплаты временно недоступна. Повторите позднее.';
  else if(current) status.textContent='Оплаченный доступ активен по '+diaryPaidDate(Date.parse(current.ends_at)-1000)+'.';
  else if(future) status.textContent='Оплата подтверждена. Доступ с '+diaryPaidDate(future.starts_at)+' по '+diaryPaidDate(Date.parse(future.ends_at)-1000)+'.';
  else if(now<Date.parse('2027-01-01T00:00:00+03:00')) status.textContent='Бесплатное тестирование доступно до 31 декабря 2026 года. Оплаченных периодов пока нет.';
  else status.textContent='Оплаченный доступ для этого аккаунта не найден. Для активации используйте почту, указанную при покупке.';
  if(lockedMessage){
    lockedMessage.textContent=diaryPaidState.error
      ? 'Не удалось связаться с проверкой оплаты. Проверьте интернет и нажмите «Проверить доступ» в панели аккаунта.'
      : 'Для этого аккаунта активный оплаченный период пока не найден. Проверьте подтверждение оплаты и совпадение электронной почты при покупке и регистрации.';
  }
}
function diaryPaidClear(){
  diaryPaidState.userId=null;diaryPaidState.verified=false;diaryPaidState.access=[];diaryPaidState.ownerAccess=false;diaryPaidState.error='';
  diaryPaidRender();
}
async function diaryPaidRefresh(session,userId){
  diaryPaidClear();
  if(!session?.access_token || !userId) return;
  diaryPaidState.userId=userId;
  try {
    const response=await fetch(accountProjectUrl+'/functions/v1/diary-claim-access',{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+session.access_token,'apikey':accountPublishableKey},
      body:'{}',
      cache:'no-store',
      credentials:'omit',
      signal:AbortSignal.timeout(12000)
    });
    if(!response.ok) throw Error('Access check unavailable');
    const payload=await response.json();
    if(!Array.isArray(payload.access)) throw Error('Invalid access response');
    // Never apply a delayed result to a different logged-in account.
    if(typeof verifiedAccount==='undefined' || verifiedAccount?.id!==userId) return;
    diaryPaidState.verified=true;
    diaryPaidState.ownerAccess=payload.owner_access===true;
    diaryPaidState.access=payload.access.filter(e=>
      [6,12].includes(e.months) && typeof e.starts_at==='string' &&
      typeof e.ends_at==='string' && Number.isFinite(Date.parse(e.starts_at)) &&
      Number.isFinite(Date.parse(e.ends_at))
    );
  } catch {
    if(typeof verifiedAccount!=='undefined' && verifiedAccount?.id===userId){
      diaryPaidState.error='unavailable';
      diaryPaidState.verified=false;diaryPaidState.access=[];
    }
  }
  diaryPaidRender();
}
document.getElementById('refreshPaidAccess')?.addEventListener('click',async function(){
  this.disabled=true;
  try{
    if(!accountClient || !verifiedAccount) return;
    const {data,error}=await accountClient.auth.getSession();
    if(error || !data?.session) throw Error('No session');
    await diaryPaidRefresh(data.session,verifiedAccount.id);
    closeExpiredTrial();
  }catch{diaryPaidState.error='unavailable';diaryPaidRender();}
  finally{this.disabled=false;}
});
document.getElementById('lockAccountLogin')?.addEventListener('click',()=>{
  if(typeof showAccountForm==='function') showAccountForm('login');
});

document.getElementById('retryDiaryTime')?.addEventListener('click', async function() {
  this.disabled=true;
  try { await diaryClockSync(); }
  finally { this.disabled=false; }
});
// Refresh trusted time on initial load, regularly, and when returning to the tab.
diaryClockSync();
setInterval(diaryClockSync, 60000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && performance.now() - diaryClock.lastSync > 15000) diaryClockSync();
});

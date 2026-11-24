'use strict';

// Client-facing status only. All paid orders and account ownership are validated on Supabase.
// Github Pages hosts public client code; this UI gate is not a secure content paywall.
const diaryPaidState = {userId:null, verified:false, access:[], error:''};
function diaryPaidActive(){
  if(!diaryPaidState.verified || !diaryPaidState.userId) return false;
  if(typeof accountOwner === 'undefined' || accountOwner !== diaryPaidState.userId) return false;
  if(typeof verifiedAccount === 'undefined' || verifiedAccount?.id !== diaryPaidState.userId) return false;
  const now=Date.now();
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
  const now=Date.now();
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
  diaryPaidState.userId=null;diaryPaidState.verified=false;diaryPaidState.access=[];diaryPaidState.error='';
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

// Reproduction harness — extracts the REAL shipped functions, no copies.
const fs=require('fs');
function extract(src,name){const st=src.indexOf('function '+name+'(');if(st<0)throw new Error('missing '+name);
 let i=src.indexOf('{',st),d=0;for(let j=i;j<src.length;j++){if(src[j]==='{')d++;else if(src[j]==='}'){d--;if(!d)return src.slice(st,j+1);}}}
const leave=fs.readFileSync('../../js/features/leave.js','utf8');
const ot   =fs.readFileSync('../../js/features/overtime.js','utf8');
const KSA_EMP=['Salman Aziz','Mohammed Afsal'];
const WEEKEND_OVERRIDES=[{ employee:'Ahmed Ali', from:'2025-12-30', to:'2026-02-05', weekendDays:[4,5] }];
// v193: holidays are read through getPublicHoliday(); empty by default so the
// earlier cases run exactly as before.
var PUBLIC_HOLIDAYS=[];
eval([extract(ot,'isWeekend'),extract(leave,'employeeRegion'),extract(leave,'getPublicHoliday'),
      extract(leave,'calcWorkingDays'),extract(leave,'leaveEffectiveRange'),
      extract(leave,'computeLeaveUsedDays'),extract(leave,'computeUpcomingApprovedDays'),extract(leave,'_isoDayBefore')].join('\n'));

let pass=0,fail=0;
const t=(label,actual,expected)=>{
  if(actual===expected){pass++;console.log('  PASS  '+label+'  => '+actual);}
  else{fail++;console.log('  FAIL  '+label+'\n        expected '+expected+', got '+actual);}
};
const AFSAL={employee:'Mohammed Afsal',start_date:'2026-08-09',end_date:'2026-08-22',working_days:10};

console.log('\n=== THE REPORTED BUG: cancelled 06-Jul, before the 09-Aug start ===');
t('cancelled-in-advance, today 18-Aug (today)',
  computeLeaveUsedDays({...AFSAL,status:'cancelled',effective_end_date:null},'2026-08-18'), 0);
t('cancelled-in-advance, today 08-Aug (before start)',
  computeLeaveUsedDays({...AFSAL,status:'cancelled',effective_end_date:null},'2026-08-08'), 0);
t('cancelled-in-advance, today 30-Aug (after end)',
  computeLeaveUsedDays({...AFSAL,status:'cancelled',effective_end_date:null},'2026-08-30'), 0);

console.log('\n=== these must KEEP working (regression guard) ===');
t('mid-leave cancel keeps past days (eff=11-Aug)',
  computeLeaveUsedDays({...AFSAL,status:'cancelled',effective_end_date:'2026-08-11'},'2026-08-18'), 3);
t('approved, future start',
  computeLeaveUsedDays({...AFSAL,status:'approved',effective_end_date:null},'2026-08-01'), 0);
t('approved, in progress (today 12-Aug)',
  computeLeaveUsedDays({...AFSAL,status:'approved',effective_end_date:null},'2026-08-12'), 4);
t('approved, fully past',
  computeLeaveUsedDays({...AFSAL,status:'approved',effective_end_date:null},'2026-09-01'), 10);
t('pending counts nothing',
  computeLeaveUsedDays({...AFSAL,status:'pending',effective_end_date:null},'2026-08-18'), 0);
t('rejected counts nothing',
  computeLeaveUsedDays({...AFSAL,status:'rejected',effective_end_date:null},'2026-08-18'), 0);
t('half-day approved',
  computeLeaveUsedDays({employee:'Mohammed Afsal',start_date:'2026-08-10',end_date:'2026-08-10',working_days:0.5,status:'approved',effective_end_date:null},'2026-08-18'), 0.5);
t('half-day cancelled in advance',
  computeLeaveUsedDays({employee:'Mohammed Afsal',start_date:'2026-08-10',end_date:'2026-08-10',working_days:0.5,status:'cancelled',effective_end_date:null},'2026-08-18'), 0);
t('upcoming: approved future shows full',
  computeUpcomingApprovedDays({...AFSAL,status:'approved',effective_end_date:null},'2026-08-01'), 10);
t('upcoming: cancelled shows nothing',
  computeUpcomingApprovedDays({...AFSAL,status:'cancelled',effective_end_date:null},'2026-08-01'), 0);

console.log('\n=== legacy rows: no effective_end_date, judged on cancelled_at ===');
t('legacy cancelled BEFORE start -> 0',
  computeLeaveUsedDays(Object.assign({},AFSAL,{status:'cancelled',effective_end_date:null,cancelled_at:'2026-07-06T09:00:00+00:00'}),'2026-08-30'), 0);
t('legacy cancelled ON start day -> 0',
  computeLeaveUsedDays(Object.assign({},AFSAL,{status:'cancelled',effective_end_date:null,cancelled_at:'2026-08-09T09:00:00+00:00'}),'2026-08-30'), 0);
t('legacy cancelled MID-leave 12-Aug -> thru 11-Aug = 3',
  computeLeaveUsedDays(Object.assign({},AFSAL,{status:'cancelled',effective_end_date:null,cancelled_at:'2026-08-12T09:00:00+00:00',reviewed_at:'2026-07-01T09:00:00+00:00'}),'2026-08-30'), 3);
t('legacy cancelled AFTER end -> clamped to 10',
  computeLeaveUsedDays(Object.assign({},AFSAL,{status:'cancelled',effective_end_date:null,cancelled_at:'2026-09-05T09:00:00+00:00',reviewed_at:'2026-07-01T09:00:00+00:00'}),'2026-09-30'), 10);
t('cancelled, no eff + no cancelled_at -> 0',
  computeLeaveUsedDays(Object.assign({},AFSAL,{status:'cancelled',effective_end_date:null,cancelled_at:null}),'2026-08-30'), 0);

console.log('\n=== explicit effective_end_date still wins ===');
t('eff=11-Aug beats cancelled_at=20-Aug',
  computeLeaveUsedDays(Object.assign({},AFSAL,{status:'cancelled',effective_end_date:'2026-08-11',cancelled_at:'2026-08-20T09:00:00+00:00'}),'2026-08-30'), 3);

console.log('\n=== _isoDayBefore boundaries ===');
t('month boundary', _isoDayBefore('2026-08-01'), '2026-07-31');
t('year boundary',  _isoDayBefore('2026-01-01'), '2025-12-31');
t('leap day',       _isoDayBefore('2028-03-01'), '2028-02-29');

console.log('\n=== SECOND BUG: a PENDING request that was withdrawn ===');
t('pending withdrawn mid-window -> 0 (never approved)',
  computeLeaveUsedDays(Object.assign({},AFSAL,{status:'cancelled',effective_end_date:null,
    cancelled_at:'2026-08-12T09:00:00+00:00',reviewed_at:null}),'2026-08-30'), 0);
t('approved THEN cancelled mid-leave -> 3 (was really off work)',
  computeLeaveUsedDays(Object.assign({},AFSAL,{status:'cancelled',effective_end_date:null,
    cancelled_at:'2026-08-12T09:00:00+00:00',reviewed_at:'2026-07-01T09:00:00+00:00'}),'2026-08-30'), 3);

console.log('\n=== THIRD BUG: dated weekend rotations (Ahmed Ali, Thu+Fri) ===');
// 08-Jan-2026 is a Thursday. Inside the override window his weekend is Thu+Fri.
t('Thu+Fri inside override window -> 0 working days',
  calcWorkingDays('2026-01-08','2026-01-09','Ahmed Ali'), 0);
t('Sat+Sun inside override window -> 2 working days',
  calcWorkingDays('2026-01-10','2026-01-11','Ahmed Ali'), 2);
t('same dates OUTSIDE the window fall back to UAE Sat/Sun',
  calcWorkingDays('2026-03-05','2026-03-06','Ahmed Ali'), 2);
t('other UAE staff unaffected inside that window',
  calcWorkingDays('2026-01-08','2026-01-09','Prasanth'), 2);
t('KSA staff unaffected inside that window',
  calcWorkingDays('2026-01-09','2026-01-10','Mohammed Afsal'), 0);

console.log('\n=== v193: public holidays ===');
PUBLIC_HOLIDAYS=[{holiday_date:'2026-08-28',name:"Prophet's Birthday",region:'UAE',counts_for_ot:false},
                 {holiday_date:'2026-12-02',name:'National Day',region:'ALL',counts_for_ot:true},
                 {holiday_date:'2026-08-29',name:'Sat holiday',region:'UAE',counts_for_ot:true}];
t('Ahmed 05-Aug..03-Sep drops the UAE holiday (22 -> 21)',
  calcWorkingDays('2026-08-05','2026-09-03','Ahmed Ali'), 21);
t('KSA staff over the same range are not affected',
  calcWorkingDays('2026-08-05','2026-09-03','Salman Aziz'), 22);
t('a single day that is a holiday is 0',
  calcWorkingDays('2026-08-28','2026-08-28','Prasanth'), 0);
t('a holiday on a weekend is not subtracted twice',
  calcWorkingDays('2026-08-28','2026-08-31','Prasanth'), 1);
t('ALL-region holiday applies to UAE', calcWorkingDays('2026-12-01','2026-12-03','Prasanth'), 2);
t('ALL-region holiday applies to KSA', calcWorkingDays('2026-12-01','2026-12-03','Mohammed Afsal'), 2);
t('approved leave over the holiday is charged 21',
  computeLeaveUsedDays({employee:'Ahmed Ali',start_date:'2026-08-05',end_date:'2026-09-03',working_days:22,status:'approved'},'2026-10-06'), 21);
t('half day on a holiday uses nothing',
  computeLeaveUsedDays({employee:'Prasanth',start_date:'2026-08-28',end_date:'2026-08-28',working_days:0.5,status:'approved'},'2026-10-06'), 0);
t('half day on a normal day still uses 0.5',
  computeLeaveUsedDays({employee:'Prasanth',start_date:'2026-08-27',end_date:'2026-08-27',working_days:0.5,status:'approved'},'2026-10-06'), 0.5);
PUBLIC_HOLIDAYS=[];

console.log('\n' + (fail===0 ? 'ALL '+pass+' PASSED' : pass+' passed, '+fail+' FAILED'));
process.exit(fail?1:0);

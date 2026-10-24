// 番号ではなく短い「固有名」を表示。録音の内容とレシピには依存しない。
// 同じHATCH試行で同じseedなら同じ名前になる（保存名も一致）。
const NAME_ONSETS=['BI','BU','BO','PI','PU','PO','ZU','ZA','MO','MI','GI','GA','KI','KA','FU','FA','NI','NO','LU','LO','DA','DO','WA','WI'];
const NAME_TAILS=['BO','BU','CHI','PI','PON','ZU','MO','MI','KO','KI','LA','LU','NA','NE','PO','PU','TE','TO','NYA','ZO'];
export function bugName(seed){
  let x=(seed^0x9E3779B9)>>>0;
  x=Math.imul(x^(x>>>16),0x7FEB352D);x=Math.imul(x^(x>>>15),0x846CA68B);x=(x^(x>>>16))>>>0;
  const a=NAME_ONSETS[x%NAME_ONSETS.length],b=NAME_TAILS[(x>>>8)%NAME_TAILS.length];
  const suffix=(x>>>18)%5===0?NAME_TAILS[(x>>>21)%NAME_TAILS.length]:'';
  return `${a}${b}${suffix}`;
}

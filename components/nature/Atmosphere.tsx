import type { CSSProperties } from 'react';
export function Birds({ variant = '' }: { variant?: string }) {
 return <div className={`bird-flock ${variant}`} aria-hidden="true">{Array.from({length:7},(_,i)=><span key={i} className="bird" style={{'--i':i,top:`${(i%3)*18}px`} as CSSProperties}><svg viewBox="0 0 60 24"><path d="M30 15C21 4 12 2 1 3c11 5 18 12 22 17l7-3 7 3C42 12 49 5 59 3 47 2 39 5 30 15Z" fill="currentColor"/></svg></span>)}</div>;
}
export function Particles() {
 return <div className="particles" aria-hidden="true">{Array.from({length:13},(_,i)=><i key={i} style={{'--i':i,left:`${(i*23+11)%100}%`,top:`${(i*17+9)%100}%`} as CSSProperties}/>)}</div>;
}
export function Reeds({ className = '' }: {className?:string}) {
 return <div className={`reeds ${className}`} aria-hidden="true"><svg viewBox="0 0 1440 210" preserveAspectRatio="none"><path fill="#100b29" d="M0 170 0 122Q20 132 47 180L39 73Q75 114 77 172L104 104 98 188 145 141 138 204 195 160 214 192 275 175 304 203 367 188 428 206 512 189 581 209 657 201 699 183 709 210 781 203 809 174 823 206 876 185 910 208 960 167 955 204 999 157 987 210 1054 176 1080 206 1124 154 1116 200 1159 112 1147 205 1189 146 1201 191 1241 98 1217 195 1279 133 1288 183 1311 53Q1327 109 1320 182L1370 95 1349 185 1415 56 1391 184 1440 131V210H0Z"/></svg></div>;
}
export function Water({ side }: {side:'left'|'right'}) {
 return <div className={`water-motion water-${side}`} aria-hidden="true">{Array.from({length:9},(_,i)=><i key={i} style={{'--i':i} as CSSProperties}/>)}</div>;
}
export function Arrow({diagonal=false}: {diagonal?:boolean}) {
 return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d={diagonal?'M5 19 19 5M5 5h14v14':'M4 12h15m-6-6 6 6-6 6'} stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}

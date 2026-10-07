'use client';
import { useEffect, type RefObject } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
export function useNatureMotion(root: RefObject<HTMLDivElement | null>, onChapter: (id:string)=>void) {
 useEffect(()=>{
  const el=root.current; if(!el) return;
  gsap.registerPlugin(ScrollTrigger);
  const mm=gsap.matchMedia();
  const observers=new IntersectionObserver(entries=>{entries.forEach(entry=>{if(entry.isIntersecting){onChapter(entry.target.id);entry.target.classList.add('in-view');}else{entry.target.classList.remove('in-view');}});},{threshold:0.35});
  el.querySelectorAll('section[id]').forEach(section=>observers.observe(section));
  mm.add('(prefers-reduced-motion: no-preference)',()=>{
   const lenis = new Lenis({duration:1.15,smoothWheel:true,syncTouch:false,anchors:{offset:-65},prevent:node=>node.classList.contains('modal-scroll')});
   lenis.on('scroll',ScrollTrigger.update);
   const tick=(time:number)=>lenis.raf(time*1000);gsap.ticker.add(tick);
   const load=gsap.timeline({defaults:{ease:'power3.out'}});
   load.fromTo('.site-header',{opacity:0,y:-15},{opacity:1,y:0,duration:1,clearProps:'transform'})
    .fromTo('.hero-word span',{yPercent:115,rotate:3},{yPercent:0,rotate:0,stagger:0.07,duration:1.35},0.1)
    .fromTo('.hero .eyebrow,.hero-description,.hero-actions,.hero-bottom',{opacity:0,y:20},{opacity:1,y:0,duration:1,stagger:0.12},0.55)
    .fromTo('.hero .scene-art',{scale:1.06},{scale:1,duration:2.4,ease:'power2.out'},0);
   gsap.utils.toArray<HTMLElement>('.scene').forEach(scene=>{
    const art=scene.querySelector('.parallax-art');
    if(art) gsap.fromTo(art,{yPercent:-5},{yPercent:7,ease:'none',scrollTrigger:{trigger:scene,start:'top bottom',end:'bottom top',scrub:1.3}});
    const foreground=scene.querySelector('.reeds');
    if(foreground)gsap.fromTo(foreground,{y:65},{y:-32,ease:'none',scrollTrigger:{trigger:scene,start:'top bottom',end:'bottom top',scrub:1}});
    const flock=scene.querySelector('.bird-flock');
    if(flock)gsap.fromTo(flock,{xPercent:-40,y:40},{xPercent:50,y:-60,ease:'none',scrollTrigger:{trigger:scene,start:'top bottom',end:'bottom top',scrub:1.6}});
   });
   gsap.utils.toArray<HTMLElement>('.reveal').forEach(item=>{gsap.fromTo(item,{opacity:0,y:42},{opacity:1,y:0,duration:1.1,ease:'power3.out',scrollTrigger:{trigger:item,start:'top 91%',once:true}});});
   gsap.fromTo('.manifesto-line',{opacity:0.22},{opacity:1,stagger:0.2,ease:'none',scrollTrigger:{trigger:'.manifesto',start:'top 68%',end:'bottom 68%',scrub:1}});
   gsap.to('.reading-progress',{scaleX:1,ease:'none',scrollTrigger:{trigger:el,start:'top top',end:'bottom bottom',scrub:0.3}});
   const fine=window.matchMedia('(pointer: fine)').matches;
   const hero=el.querySelector<HTMLElement>('.hero');
   const light=el.querySelector<HTMLElement>('.hero-glow');
   const move=(e:MouseEvent)=>{if(light&&hero)gsap.to(light,{x:(e.clientX/window.innerWidth-0.5)*35,y:(e.clientY/window.innerHeight-0.5)*25,duration:1.6,overwrite:'auto'});};
   if(fine)hero?.addEventListener('mousemove',move,{passive:true});
   const refresh=()=>ScrollTrigger.refresh();
   el.querySelectorAll('img').forEach(img=>img.addEventListener('load',refresh));
   const initialRefresh=window.setTimeout(refresh,300);
   return ()=>{clearTimeout(initialRefresh);el.querySelectorAll('img').forEach(img=>img.removeEventListener('load',refresh));hero?.removeEventListener('mousemove',move);gsap.ticker.remove(tick);lenis.destroy();};
  },el);
  return ()=>{observers.disconnect();mm.revert();};
 },[root,onChapter]);
}

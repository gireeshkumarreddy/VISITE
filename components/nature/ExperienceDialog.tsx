'use client';
import { useEffect, useRef, type ReactNode } from 'react';
export default function ExperienceDialog({title,children,onClose,className=''}:{title:string;children:ReactNode;onClose:()=>void;className?:string}){
 const ref=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const dialog=ref.current;if(dialog&&!dialog.open)dialog.showModal();return()=>dialog?.close();},[]);
 return <dialog data-lenis-prevent ref={ref} className={`experience-dialog ${className}`} onClose={onClose} aria-label={title} onClick={e=>{if(e.target===e.currentTarget)onClose();}}><div className="dialog-inner modal-scroll" data-lenis-prevent><button className="dialog-close" onClick={onClose} aria-label="Close dialog"><span/><span/></button>{children}</div></dialog>;
}

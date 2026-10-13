import React from '../productivity/node_modules/react';
import { createRoot } from '../productivity/node_modules/react-dom/client';
import FocusOverlay from '../productivity/src/components/FocusOverlay';
export async function verifyFocus(){
  const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
  const callbacks:Record<string,(value:any)=>void>={};
  const previous=window.electronAPI;
  const api:any={};for(const name of ['onAppCloseWarning','onAppCloseWarningCancelled','onAppBlocked','onAppBlockFailedPrivilege','onFocusStateChanged'])api[name]=(fn:any)=>{callbacks[name]=fn;return()=>delete callbacks[name];};
  window.electronAPI=api;
  const el=document.createElement('div');document.body.append(el);const root=createRoot(el);root.render(<FocusOverlay/>);
  const assert=(value:unknown,message:string)=>{if(!value)throw new Error(message);};
  try{
    await wait(100);callbacks.onAppCloseWarning('chrome');await wait(30);
    assert(el.textContent?.includes('4seconds left'),'Warning countdown does not start at four');
    await wait(5600);assert(!el.textContent?.includes('Focus Interruption'),'Focus overlay stuck at zero');
    callbacks.onAppCloseWarning('chrome');await wait(20);callbacks.onFocusStateChanged({active:false});await wait(20);assert(!el.textContent?.includes('Focus Interruption'),'Stopping focus did not dismiss warning');
    callbacks.onAppCloseWarning('chrome');await wait(20);el.querySelector('button')?.click();await wait(20);assert(!el.textContent?.includes('Focus Interruption'),'Dismiss did not close warning');
  }finally{root.unmount();el.remove();window.electronAPI=previous;}
}

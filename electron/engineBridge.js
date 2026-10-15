const {StringDecoder}=require('node:string_decoder');

// One action worker retains browser sessions between calls. It never opens a
// microphone. Requests are serialized, correlated, bounded and never replayed.
class EngineBridge {
  constructor({spawn,terminate,timeoutMs=180000}) {
    Object.assign(this,{spawn,terminate,timeoutMs});
    this.proc=null;this.active=null;this.queue=[];this.serial=0;this.stopping=null;
  }
  request(payload) {
    return new Promise(resolve=>{
      this.queue.push({payload,id:++this.serial,resolve});
      this.pump();
    });
  }
  pump() {
    if(this.stopping||this.active||!this.queue.length)return;
    if(!this.proc){
      let proc;
      try{proc=this.spawn();}catch{this.fail('The action engine could not start');return;}
      this.proc=proc;
      const decoder=new StringDecoder('utf8');let buffer='';
      proc.stdout.on('data',chunk=>{
        if(this.proc!==proc)return;
        buffer+=decoder.write(chunk);
        if(buffer.length>2*1024*1024){this.fail('Action engine response exceeded its limit');return;}
        let end;
        while((end=buffer.indexOf('\n'))>=0){
          const line=buffer.slice(0,end);buffer=buffer.slice(end+1);
          let msg;try{msg=JSON.parse(line);}catch{continue;}
          if(msg.id!==this.active?.id)continue;
          const job=this.active;this.active=null;clearTimeout(job.timer);
          job.resolve(msg);this.pump();
        }
      });
      // Drain diagnostic output without leaking provider credentials to the UI.
      proc.stderr.on('data',()=>{});
      proc.stdin.on('error',()=>{if(this.proc===proc)this.fail('Action engine input closed');});
      proc.on('error',()=>{if(this.proc===proc)this.fail('Action engine could not run');});
      proc.on('close',()=>{if(this.proc===proc)this.fail('Action engine stopped before completing the request');});
    }
    const job=this.active=this.queue.shift();
    job.timer=setTimeout(()=>this.fail('Action timed out; it was not retried'),this.timeoutMs);
    try{this.proc.stdin.write(JSON.stringify({...job.payload,id:job.id})+'\n');}
    catch{this.fail('Action engine input is unavailable');}
  }
  fail(message) {void this.stop(message);}
  stop(message='Action engine was restarted; retry the request if needed') {
    const proc=this.proc;this.proc=null;
    for(const job of [this.active,...this.queue])if(job){clearTimeout(job.timer);job.resolve({success:false,error:message});}
    this.active=null;this.queue=[];
    if(this.stopping)return this.stopping;
    if(!proc)return Promise.resolve();
    this.stopping=Promise.resolve().then(()=>this.terminate(proc)).catch(()=>{}).finally(()=>{this.stopping=null;this.pump();});
    return this.stopping;
  }
}
module.exports={EngineBridge};

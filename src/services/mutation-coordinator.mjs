import {StoreError} from '../storage/errors.mjs';

const blocked=()=>new StoreError('DATA_RESTORE_IN_PROGRESS','正在恢复数据，请稍后重试');

export function createMutationCoordinator() {
  let restoring=false,activeWrites=0,drain=Promise.resolve(),resolveDrain;
  return {
    isRestoring:()=>restoring,
    async runWrite(fn) {
      if(restoring)throw blocked();
      if(activeWrites++===0)drain=new Promise(resolve=>{resolveDrain=resolve;});
      try{return await fn();}
      finally {if(--activeWrites===0){resolveDrain();resolveDrain=undefined;}}
    },
    async runRestore(fn) {
      if(restoring)throw blocked();
      restoring=true;
      try{await drain;return await fn();}
      finally{restoring=false;}
    },
  };
}

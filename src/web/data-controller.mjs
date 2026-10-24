export function createDataController({api,render,confirm=()=>false,reload=()=>{},download=()=>{},initialMessage=''}={}) {
  let sequence=0,disposed=false,busy=false,data=null,note='',error='',message=initialMessage;
  const snapshot=()=>({type:'data',data,note,busy,error,message});
  const emit=()=>{if(!disposed)render(snapshot());};
  const failure=value=>{if(!disposed){error=value?.message??'操作失败，请重试';message='';}};
  async function refresh(successMessage='') {
    const token=++sequence;const value=await api.dataBackups();if(disposed||token!==sequence)return false;
    data=value;message=successMessage;return true;
  }
  async function mutation(action,successMessage,{clearNote=false}={}) {
    if(disposed||busy)return;busy=true;error='';message='';emit();
    try {await action();if(clearNote)note='';await refresh(successMessage);}
    catch(reason){failure(reason);}
    finally{busy=false;emit();}
  }
  return {
    async load() {
      if(disposed)return;const token=++sequence;render({type:'data-loading'});
      try {const value=await api.dataBackups();if(disposed||token!==sequence)return;data=value;error='';emit();}
      catch(reason){if(disposed||token!==sequence)return;failure(reason);render({type:'data-error',error});}
    },
    setNote(value) {if(disposed||busy)return;note=Array.from(String(value??'')).slice(0,80).join('');error='';emit();},
    createBackup() {return mutation(()=>api.createDataBackup(note),'备份已创建。',{clearNote:true});},
    importBackup(file) {if(!file||disposed||busy)return;return mutation(()=>api.importDataBackup(file),'导入成功，备份已加入列表。');},
    async restore(record) {
      if(disposed||busy||!record)return;
      const accepted=await confirm(`将恢复 ${record.createdAt} 的全部数据。当前数据会先创建安全备份，确定继续吗？`);if(!accepted||disposed)return;
      busy=true;error='';message='';emit();
      try {await api.restoreDataBackup(record.id);if(disposed)return;busy=false;emit();reload('数据恢复成功，已重新载入。');}
      catch(reason){failure(reason);busy=false;emit();}
    },
    download(record) {if(!disposed&&record)download(api.dataBackupDownloadUrl(record.id));},
    dispose(){disposed=true;sequence++;},
    snapshot,
  };
}

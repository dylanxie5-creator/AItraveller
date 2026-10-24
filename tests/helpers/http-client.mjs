import http from 'node:http';
export function request(url,{method='GET',path='/',body,headers={}}={}) {
  const origin=new URL(url);const data=Buffer.isBuffer(body)?body:typeof body==='string'?body:body===undefined?undefined:JSON.stringify(body);
  return new Promise((resolve,reject)=>{
    const req=http.request({hostname:origin.hostname,port:origin.port,path,method,headers:{...(method==='GET'?{}:{Origin:origin.origin,'Content-Type':'application/json'}),...(data!==undefined?{'Content-Length':Buffer.byteLength(data)}:{}),...headers}},res=>{
      const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>{const buffer=Buffer.concat(chunks),text=buffer.toString();let json;try{json=JSON.parse(text);}catch{}resolve({status:res.statusCode,headers:res.headers,buffer,text,json});});
    });req.on('error',reject);req.end(data);
  });
}

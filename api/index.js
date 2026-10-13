import { createRuntime } from '../src/runtime.js';

let runtime;
export default async function handler(req,res) {
  try {
    runtime ??= createRuntime();
    await runtime.handler(req,res);
  } catch (error) {
    console.error('Deployment configuration failed:', error.name);
    res.writeHead(503,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
    res.end(JSON.stringify({action:'error',reply:'الخدمة غير جاهزة. تحقق من إعدادات النشر.'}));
  }
}

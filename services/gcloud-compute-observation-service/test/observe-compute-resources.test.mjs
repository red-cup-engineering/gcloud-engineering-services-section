import test from 'node:test';
import assert from 'node:assert/strict';
import {observeGoogleCloudComputeResources} from '../src/observe-compute-resources.mjs';

const observed = value => ({status:'observed',value});
const fixture = (respond = () => observed([])) => {
  const calls=[];
  return {calls,jsonCommand:async(bin,args,environment)=>{
    calls.push({bin,args,environment});return respond(args);
  }};
};
test('native empty project list remains a genuine observed empty inventory',async()=>{
  const result=await observeGoogleCloudComputeResources({cloudRunRegion:'asia-east1'},fixture());
  assert.equal(result.status,'observed');assert.deepEqual(result.projects,[]);
});
test('malformed project list cannot become empty observed inventory',async()=>{
  for(const value of [null,{},[{}],['project']]){
    const result=await observeGoogleCloudComputeResources({cloudRunRegion:'asia-east1'},fixture(()=>observed(value)));
    assert.equal(result.status,'unavailable');assert.deepEqual(result.projects,[]);
  }
});
test('unknown enabled services remain unknown rather than not-enabled',async()=>{
  const seam=fixture(args=>args[0]==='projects'?observed([{projectId:'fixture-project'}])
    :args[0]==='billing'?observed({billingEnabled:true}):args[0]==='services'?observed(null):observed([]));
  const {projects:[project]}=await observeGoogleCloudComputeResources({cloudRunRegion:'asia-east1'},seam);
  for(const field of ['cloudRun','computeInstances','storageBuckets']){
    assert.equal(project[field].status,'unavailable');assert.equal(project[field].reason,'enabled-services-unobserved');
  }
  assert.equal(seam.calls.some(call=>['run','compute','storage'].includes(call.args[0])),false);
});
test('native storage and compute coordinates are typed and arbitrary provider fields are discarded',async()=>{
  const seam=fixture(args=>{
    if(args[0]==='projects')return observed([{projectId:'fixture-project',secret:'DUMMY_SECRET'}]);
    if(args[0]==='billing')return observed({billingEnabled:true,secret:'DUMMY_SECRET'});
    if(args[0]==='services')return observed(['compute','storage'].map(name=>({config:{name:name+'.googleapis.com'}})));
    if(args[0]==='storage')return observed([{name:'fixture-bucket',location:'EU',storageClass:'STANDARD',secret:'DUMMY_SECRET'}]);
    if(args[0]==='compute')return observed([{name:'fixture-instance',zone:'projects/x/zones/fixture-zone',status:'RUNNING',machineType:'types/fixture',secret:'DUMMY_SECRET'}]);
    return observed([]);
  });
  const result=await observeGoogleCloudComputeResources({cloudRunRegion:'asia-east1'},seam),project=result.projects[0];
  assert.deepEqual(project.computeInstances.instances,[{name:'fixture-instance',zone:'fixture-zone',status:'RUNNING',machineType:'fixture'}]);
  assert.equal(project.storageBuckets.buckets[0].name,'fixture-bucket');assert.doesNotMatch(JSON.stringify(result),/DUMMY_SECRET/);
  for(const call of seam.calls){assert.equal(call.bin,'gcloud');assert.ok(call.args.includes('--quiet'));
    assert.ok(call.args.includes('--format=json'));assert.deepEqual(call.environment,{CLOUDSDK_CORE_DISABLE_PROMPTS:'1'});}
});
test('malformed native instances cannot supply positive inventory',async()=>{
  const seam=fixture(args=>args[0]==='projects'?observed([{projectId:'fixture-project'}])
    :args[0]==='billing'?observed({billingEnabled:true})
    :args[0]==='services'?observed([{config:{name:'compute.googleapis.com'}}])
    :args[0]==='compute'?observed([{name:'instance-without-zone'}]):observed([]));
  const {projects:[project]}=await observeGoogleCloudComputeResources({cloudRunRegion:'asia-east1'},seam);
  assert.deepEqual(project.computeInstances,{status:'unavailable',reason:'invalid-native-list'});
});

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
  for(const field of ['cloudRun','cloudRunJobs','cloudFunctions','computeInstances','storageBuckets']){
    assert.equal(project[field].status,'unavailable');assert.equal(project[field].reason,'enabled-services-unobserved');
  }
  assert.equal(seam.calls.some(call=>['run','compute','storage','functions'].includes(call.args[0])),false);
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
  assert.equal(project.cloudRunJobs.status,'not-enabled');assert.equal(project.cloudFunctions.status,'not-enabled');
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

test('regional Cloud Run jobs and functions are separate observed resources without implied capacity',async()=>{
  const seam=fixture(args=>{
    if(args[0]==='projects')return observed([{projectId:'fixture-project'}]);
    if(args[0]==='billing')return observed({billingEnabled:false});
    if(args[0]==='services')return observed(['run','cloudfunctions'].map(name=>({config:{name:name+'.googleapis.com'}})));
    if(args[0]==='run' && args[1]==='services')return observed([]);
    if(args[0]==='run' && args[1]==='jobs')return observed([{metadata:{name:'fixture-job',secret:'DUMMY_SECRET'},secrets:['DUMMY_SECRET']},
      {name:'projects/fixture-project/locations/asia-east1/jobs/fixture-v2-job',secret:'DUMMY_SECRET'}]);
    if(args[0]==='functions')return observed([{name:'projects/fixture-project/locations/asia-east1/functions/fixture-function',
      buildConfig:{runtime:'nodejs24',secrets:'DUMMY_SECRET'},state:'ACTIVE',secret:'DUMMY_SECRET'}]);
    return observed([]);
  });
  const {projects:[project]}=await observeGoogleCloudComputeResources({cloudRunRegion:'asia-east1'},seam);
  assert.deepEqual(project.cloudRunJobs,{region:'asia-east1',status:'observed',jobs:[{name:'fixture-job'},{name:'fixture-v2-job'}]});
  assert.deepEqual(project.cloudFunctions,{region:'asia-east1',status:'observed',functions:[{name:'fixture-function',runtime:'nodejs24',state:'ACTIVE'}]});
  assert.equal(project.computeInstances.status,'unavailable');
  assert.equal(seam.calls.some(call=>call.args[0]==='compute'),false);
  assert.equal(seam.calls.some(call=>call.args[0]==='run' && call.args[1]==='jobs' && call.args.includes('--region=asia-east1')),true);
  assert.equal(seam.calls.some(call=>call.args[0]==='functions' && call.args.includes('--regions=asia-east1')),true);
  assert.doesNotMatch(JSON.stringify(project),/DUMMY_SECRET/);
});
test('regional API refusal and malformed job/function inventories never become observed emptiness',async()=>{
  const seam=fixture(args=>{
    if(args[0]==='projects')return observed([{projectId:'fixture-project'}]);
    if(args[0]==='billing')return observed({billingEnabled:true});
    if(args[0]==='services')return observed(['run','cloudfunctions'].map(name=>({config:{name:name+'.googleapis.com'}})));
    if(args[0]==='run' && args[1]==='jobs')return {status:'unavailable',reason:'permission-denied'};
    if(args[0]==='functions')return observed([{runtime:'nodejs24'}]);
    return observed([]);
  });
  const {projects:[project]}=await observeGoogleCloudComputeResources({cloudRunRegion:'asia-east1'},seam);
  assert.deepEqual(project.cloudRunJobs,{status:'unavailable',reason:'permission-denied',region:'asia-east1'});
  assert.deepEqual(project.cloudFunctions,{status:'unavailable',reason:'invalid-native-list',region:'asia-east1'});
  assert.deepEqual(project.cloudRun.services,[]);
});

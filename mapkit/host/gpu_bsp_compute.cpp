#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <d3d11.h>
#include <d3dcompiler.h>
#include <dxgi.h>
#include <wrl/client.h>
#include <algorithm>
#include <cstdio>
#include <cstring>
#include <vector>
#include "gpu_bsp_compute.h"
using Microsoft::WRL::ComPtr;
static ComPtr<ID3D11Device> device;
static ComPtr<ID3D11DeviceContext> context;
static ComPtr<ID3D11ComputeShader> shader;
static bool attempted=false;
static char adapter[256]="GPU unavailable";
static const char* hlsl=R"HLSL(
struct Poly {float4 plane;uint count,flags;uint2 padding;float4 vertices[16];};
StructuredBuffer<Poly> polys:register(t0);
StructuredBuffer<uint> candidates:register(t1);
RWStructuredBuffer<uint4> result:register(u0);
cbuffer Params:register(b0) {uint count,nc,step,padding;};
groupshared uint4 sums[128];
[numthreads(128,1,1)]
void main(uint3 group:SV_GroupID,uint lane:SV_GroupIndex) {
    uint ci=candidates[group.x];float4 plane=polys[ci].plane;
    uint4 total=0;
    for(uint j=lane*step;j<count;j+=128*step) {
        if(j==ci)continue;
        bool front=false,back=false,maybeFront=false,maybeBack=false;
        for(uint v=0;v<polys[j].count;v++) {
            float3 p=polys[j].vertices[v].xyz;
            precise float x=plane.x*p.x,z=plane.z*p.z,y=plane.y*p.y;
            precise float dist=((z+x)+y)-plane.w;
            // Enclose single/extended x87 rounding and shader rounding. Cases
            // near either native +/-0.25 threshold are recomputed by the SDK.
            float error=(abs(x)+abs(y)+abs(z)+abs(plane.w)+1.0)*0.000003814697265625;
            front=front||(dist-error>0.25);back=back||(dist+error< -0.25);
            maybeFront=maybeFront||(dist+error>0.25);maybeBack=maybeBack||(dist-error< -0.25);
        }
        if(front&&back)total.z+=(polys[j].flags&0x04000000)?16:1;
        else if(front!=maybeFront||back!=maybeBack)total.w++;
        else if(front)total.x++;
        else if(back)total.y++;
    }
    sums[lane]=total;GroupMemoryBarrierWithGroupSync();
    for(uint offset=64;offset>0;offset/=2) {
        if(lane<offset)sums[lane]+=sums[lane+offset];
        GroupMemoryBarrierWithGroupSync();
    }
    if(lane==0)result[group.x]=sums[0];
})HLSL";
extern "C" int gpu_bsp_initialize(char* name,uint32_t cap) {
    if(!attempted) {
        attempted=true;
        // Optional delay-loaded APIs: unavailable graphics components must
        // leave the stock compiler usable (including software-only setups).
        const wchar_t* libraries[]={L"d3d11.dll",L"dxgi.dll",L"d3dcompiler_47.dll"};
        for(auto lib:libraries)if(!LoadLibraryExW(lib,nullptr,LOAD_LIBRARY_SEARCH_SYSTEM32)) {
            if(name&&cap)snprintf(name,cap,"DirectCompute runtime unavailable");return 0;
        }
        ComPtr<IDXGIFactory1> factory;
        if(SUCCEEDED(CreateDXGIFactory1(IID_PPV_ARGS(&factory)))) {
            struct Candidate {ComPtr<IDXGIAdapter1> a;SIZE_T bytes;};std::vector<Candidate> all;
            for(UINT i=0;;i++) {ComPtr<IDXGIAdapter1> a;if(factory->EnumAdapters1(i,&a)==DXGI_ERROR_NOT_FOUND)break;
                if(!a)break;DXGI_ADAPTER_DESC1 d={};a->GetDesc1(&d);
                if(!(d.Flags&DXGI_ADAPTER_FLAG_SOFTWARE))all.push_back({a,d.DedicatedVideoMemory});}
            std::stable_sort(all.begin(),all.end(),[](const Candidate&a,const Candidate&b){return a.bytes>b.bytes;});
            for(auto& c:all) {
                D3D_FEATURE_LEVEL level,wanted[]={D3D_FEATURE_LEVEL_11_0};
                if(FAILED(D3D11CreateDevice(c.a.Get(),D3D_DRIVER_TYPE_UNKNOWN,nullptr,0,wanted,1,D3D11_SDK_VERSION,
                    &device,&level,&context)))continue;
                ComPtr<ID3DBlob> code,errors;
                HRESULT hr=D3DCompile(hlsl,strlen(hlsl),"BSP counts",nullptr,nullptr,"main","cs_5_0",
                    D3DCOMPILE_ENABLE_STRICTNESS|D3DCOMPILE_IEEE_STRICTNESS|D3DCOMPILE_OPTIMIZATION_LEVEL3,0,&code,&errors);
                if(FAILED(hr)) {if(errors)snprintf(adapter,sizeof(adapter),"%.230s",(char*)errors->GetBufferPointer());break;}
                if(SUCCEEDED(device->CreateComputeShader(code->GetBufferPointer(),code->GetBufferSize(),nullptr,&shader))) {
                    DXGI_ADAPTER_DESC1 d={};c.a->GetDesc1(&d);WideCharToMultiByte(CP_UTF8,0,d.Description,-1,adapter,sizeof(adapter),nullptr,nullptr);break;
                }
                context.Reset();device.Reset();
            }
        }
    }
    if(name&&cap)snprintf(name,cap,"%s",adapter);
    return shader?1:0;
}
static bool input(const void* ptr,UINT bytes,UINT stride,ComPtr<ID3D11Buffer>& b,ComPtr<ID3D11ShaderResourceView>& v) {
    D3D11_BUFFER_DESC d={};d.ByteWidth=bytes;d.Usage=D3D11_USAGE_IMMUTABLE;d.BindFlags=D3D11_BIND_SHADER_RESOURCE;
    d.MiscFlags=D3D11_RESOURCE_MISC_BUFFER_STRUCTURED;d.StructureByteStride=stride;
    D3D11_SUBRESOURCE_DATA init={};init.pSysMem=ptr;
    return SUCCEEDED(device->CreateBuffer(&d,&init,&b))&&SUCCEEDED(device->CreateShaderResourceView(b.Get(),nullptr,&v));
}
extern "C" int gpu_bsp_counts(const GpuBspPoly* polys,uint32_t n,const uint32_t* indices,uint32_t nc,uint32_t step,GpuBspCount* out) {
    if(!polys||!indices||!out||!n||n>65535||!nc||nc>n||!step||step>n||!gpu_bsp_initialize(nullptr,0))return 0;
    ComPtr<ID3D11Buffer> p,c,b,read,params;
    ComPtr<ID3D11ShaderResourceView> pv,cv;ComPtr<ID3D11UnorderedAccessView> uv;
    if(!input(polys,n*sizeof(*polys),sizeof(*polys),p,pv)||!input(indices,nc*4,4,c,cv))return 0;
    D3D11_BUFFER_DESC d={};d.ByteWidth=nc*sizeof(*out);d.Usage=D3D11_USAGE_DEFAULT;d.BindFlags=D3D11_BIND_UNORDERED_ACCESS;
    d.MiscFlags=D3D11_RESOURCE_MISC_BUFFER_STRUCTURED;d.StructureByteStride=sizeof(*out);
    if(FAILED(device->CreateBuffer(&d,nullptr,&b))||FAILED(device->CreateUnorderedAccessView(b.Get(),nullptr,&uv)))return 0;
    d.Usage=D3D11_USAGE_STAGING;d.BindFlags=0;d.CPUAccessFlags=D3D11_CPU_ACCESS_READ;d.MiscFlags=0;d.StructureByteStride=0;
    if(FAILED(device->CreateBuffer(&d,nullptr,&read)))return 0;
    uint32_t counts[]={n,nc,step,0};d={};d.ByteWidth=16;d.Usage=D3D11_USAGE_IMMUTABLE;d.BindFlags=D3D11_BIND_CONSTANT_BUFFER;
    D3D11_SUBRESOURCE_DATA data={};data.pSysMem=counts;
    if(FAILED(device->CreateBuffer(&d,&data,&params)))return 0;
    ID3D11ShaderResourceView* srvs[]={pv.Get(),cv.Get()};ID3D11UnorderedAccessView* uavs[]={uv.Get()};ID3D11Buffer* cb=params.Get();
    context->CSSetShader(shader.Get(),nullptr,0);context->CSSetShaderResources(0,2,srvs);context->CSSetUnorderedAccessViews(0,1,uavs,nullptr);
    context->CSSetConstantBuffers(0,1,&cb);context->Dispatch(nc,1,1);
    ID3D11ShaderResourceView* nullsrvs[]={nullptr,nullptr};ID3D11UnorderedAccessView* nulluav=nullptr;ID3D11Buffer* nullcb=nullptr;
    context->CSSetShaderResources(0,2,nullsrvs);context->CSSetUnorderedAccessViews(0,1,&nulluav,nullptr);context->CSSetConstantBuffers(0,1,&nullcb);
    context->CopyResource(read.Get(),b.Get());D3D11_MAPPED_SUBRESOURCE mapped={};
    if(FAILED(context->Map(read.Get(),0,D3D11_MAP_READ,0,&mapped)))return 0;
    memcpy(out,mapped.pData,nc*sizeof(*out));context->Unmap(read.Get(),0);
    return SUCCEEDED(device->GetDeviceRemovedReason())?1:0;
}

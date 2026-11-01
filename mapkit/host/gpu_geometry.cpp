// Optional, editor-only geometry preparation. No UE1 package/BSP writes.
// C ABI for 64-bit Python; DirectCompute on hardware, never WARP.
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <d3d11.h>
#include <d3dcompiler.h>
#include <dxgi.h>
#include <wrl/client.h>
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <mutex>
#include <vector>
using Microsoft::WRL::ComPtr;
static_assert(sizeof(double)==8, "IEEE double required");
static std::mutex gate;
static ComPtr<ID3D11Device> device;
static ComPtr<ID3D11DeviceContext> context;
static ComPtr<ID3D11ComputeShader> shader;
static char adapterName[256]="uninitialized";
static bool attempted=false;
static const char* source=R"HLSL(
StructuredBuffer<double> vertices : register(t0); // xyz, polygon index
StructuredBuffer<double> polygons : register(t1); // 24 doubles per polygon
RWStructuredBuffer<double4> result : register(u0);
cbuffer Counts : register(b0) { uint count; uint3 unused; };
[numthreads(128,1,1)]
void main(uint3 tid : SV_DispatchThreadID) {
    uint i=tid.x;
    if(i>=count) return;
    uint p=(uint)vertices[i*4+3]*24;
    precise double dx=vertices[i*4]-polygons[p];
    precise double dy=vertices[i*4+1]-polygons[p+1];
    precise double dz=vertices[i*4+2]-polygons[p+2];
    precise double du=(dx*polygons[p+3]+dy*polygons[p+4])+dz*polygons[p+5];
    precise double dv=(dx*polygons[p+6]+dy*polygons[p+7])+dz*polygons[p+8];
    precise double u=(du+polygons[p+9])/polygons[p+11];
    precise double v=(dv+polygons[p+10])/polygons[p+12];
    precise double lu=1.5/polygons[p+21], lv=1.5/polygons[p+22];
    if(polygons[p+23]!=0.0) {
        precise double x=min(max((du-polygons[p+17])/polygons[p+19],0.0),polygons[p+15]-1.0);
        precise double y=min(max((dv-polygons[p+18])/polygons[p+20],0.0),polygons[p+16]-1.0);
        lu=((polygons[p+13]+1.0)+x+0.5)/polygons[p+21];
        lv=((polygons[p+14]+1.0)+y+0.5)/polygons[p+22];
    }
    result[i]=double4(u,v,lu,lv);
})HLSL";

static bool initialize() {
    if(attempted) return shader.Get()!=nullptr;
    attempted=true;
    ComPtr<IDXGIFactory1> factory;
    if(FAILED(CreateDXGIFactory1(IID_PPV_ARGS(&factory)))) return false;
    struct Candidate {ComPtr<IDXGIAdapter1> adapter; SIZE_T memory;};
    std::vector<Candidate> candidates;
    for(UINT i=0;;++i) {
        ComPtr<IDXGIAdapter1> a;
        if(factory->EnumAdapters1(i,&a)==DXGI_ERROR_NOT_FOUND) break;
        if(!a) continue;
        DXGI_ADAPTER_DESC1 desc={}; a->GetDesc1(&desc);
        if(!(desc.Flags&DXGI_ADAPTER_FLAG_SOFTWARE)) candidates.push_back({a,desc.DedicatedVideoMemory});
    }
    std::stable_sort(candidates.begin(),candidates.end(),[](const Candidate& a,const Candidate& b){return a.memory>b.memory;});
    for(auto& c:candidates) {
        D3D_FEATURE_LEVEL level;
        const D3D_FEATURE_LEVEL levels[]={D3D_FEATURE_LEVEL_11_0};
        if(FAILED(D3D11CreateDevice(c.adapter.Get(),D3D_DRIVER_TYPE_UNKNOWN,nullptr,0,levels,1,
                D3D11_SDK_VERSION,&device,&level,&context))) continue;
        D3D11_FEATURE_DATA_DOUBLES doubles={};
        D3D11_FEATURE_DATA_D3D11_OPTIONS options={};
        if(FAILED(device->CheckFeatureSupport(D3D11_FEATURE_DOUBLES,&doubles,sizeof(doubles))) ||
           !doubles.DoublePrecisionFloatShaderOps ||
           FAILED(device->CheckFeatureSupport(D3D11_FEATURE_D3D11_OPTIONS,&options,sizeof(options))) ||
           !options.ExtendedDoublesShaderInstructions) {context.Reset();device.Reset();continue;}
        ComPtr<ID3DBlob> bytecode,errors;
        HRESULT hr=D3DCompile(source,strlen(source),"geometry",nullptr,nullptr,"main","cs_5_0",
                             D3DCOMPILE_ENABLE_STRICTNESS|D3DCOMPILE_IEEE_STRICTNESS|D3DCOMPILE_OPTIMIZATION_LEVEL3,
                             0,&bytecode,&errors);
        if(FAILED(hr)) {
            if(errors) snprintf(adapterName,sizeof(adapterName),"Shader: %.220s",(char*)errors->GetBufferPointer());
            return false;
        }
        if(FAILED(device->CreateComputeShader(bytecode->GetBufferPointer(),bytecode->GetBufferSize(),nullptr,&shader))) {
            context.Reset();device.Reset();continue;
        }
        DXGI_ADAPTER_DESC1 desc={};c.adapter->GetDesc1(&desc);
        WideCharToMultiByte(CP_UTF8,0,desc.Description,-1,adapterName,sizeof(adapterName),nullptr,nullptr);
        return true;
    }
    return false;
}

extern "C" __declspec(dllexport) int dg_version() {return 1;}
extern "C" __declspec(dllexport) int dg_adapter(char* out,uint32_t size) {
    std::lock_guard<std::mutex> lock(gate);
    bool available=initialize();
    if(out&&size) snprintf(out,size,"%s",adapterName);
    return available?1:0;
}

static bool inputBuffer(const void* src,UINT size,UINT stride,ComPtr<ID3D11Buffer>& buffer,
                        ComPtr<ID3D11ShaderResourceView>& view) {
    D3D11_BUFFER_DESC d={};d.ByteWidth=size;d.Usage=D3D11_USAGE_IMMUTABLE;
    d.BindFlags=D3D11_BIND_SHADER_RESOURCE;d.MiscFlags=D3D11_RESOURCE_MISC_BUFFER_STRUCTURED;d.StructureByteStride=stride;
    D3D11_SUBRESOURCE_DATA data={};data.pSysMem=src;
    return SUCCEEDED(device->CreateBuffer(&d,&data,&buffer))&&
           SUCCEEDED(device->CreateShaderResourceView(buffer.Get(),nullptr,&view));
}

static void cpu(const double* verts,const double* params,uint32_t count,double* out) {
    for(uint32_t i=0;i<count;i++) {
        const double* p=params+(uint32_t)verts[i*4+3]*24;
        double dx=verts[i*4]-p[0],dy=verts[i*4+1]-p[1],dz=verts[i*4+2]-p[2];
        double du=(dx*p[3]+dy*p[4])+dz*p[5],dv=(dx*p[6]+dy*p[7])+dz*p[8];
        out[i*4]=(du+p[9])/p[11];out[i*4+1]=(dv+p[10])/p[12];
        double lu=1.5/p[21],lv=1.5/p[22];
        if(p[23]!=0) {
            double x=std::min(std::max((du-p[17])/p[19],0.0),p[15]-1.0);
            double y=std::min(std::max((dv-p[18])/p[20],0.0),p[16]-1.0);
            lu=((p[13]+1.0)+x+0.5)/p[21];lv=((p[14]+1.0)+y+0.5)/p[22];
        }
        out[i*4+2]=lu;out[i*4+3]=lv;
    }
}

// Return 1=hardware GPU, 0=native CPU, negative=refused/error. No partial output on GPU failure.
extern "C" __declspec(dllexport) int dg_map(const double* verts,uint32_t count,const double* params,
                                           uint32_t polygons,double* out,int useGpu) {
    if(!verts||!params||!out||count>2000000||!polygons||polygons>500000) return -1;
    if(!count) return 0;
    for(uint32_t i=0;i<count;i++) {
        for(int k=0;k<4;k++) if(!std::isfinite(verts[i*4+k])) return -2;
        double p=verts[i*4+3];if(p<0||p>=polygons||p!=std::floor(p)) return -2;
    }
    for(uint32_t i=0;i<polygons;i++) {
        const double* p=params+i*24;
        for(int k=0;k<24;k++) if(!std::isfinite(p[k])) return -2;
        if(p[11]==0||p[12]==0||p[21]<=0||p[22]<=0 ||
           (p[23]!=0&&(p[19]==0||p[20]==0||p[15]<1||p[16]<1))) return -2;
    }
    if(!useGpu) {cpu(verts,params,count,out);return 0;}
    std::lock_guard<std::mutex> lock(gate);
    if(!initialize()) return -3;
    ComPtr<ID3D11Buffer> vb,pb,ob,readback,cb;
    ComPtr<ID3D11ShaderResourceView> vv,pv;
    ComPtr<ID3D11UnorderedAccessView> ov;
    if(!inputBuffer(verts,count*32,8,vb,vv)||!inputBuffer(params,polygons*192,8,pb,pv)) return -4;
    D3D11_BUFFER_DESC d={};d.ByteWidth=count*32;d.Usage=D3D11_USAGE_DEFAULT;
    d.BindFlags=D3D11_BIND_UNORDERED_ACCESS;d.MiscFlags=D3D11_RESOURCE_MISC_BUFFER_STRUCTURED;d.StructureByteStride=32;
    if(FAILED(device->CreateBuffer(&d,nullptr,&ob)) || FAILED(device->CreateUnorderedAccessView(ob.Get(),nullptr,&ov))) return -4;
    d.Usage=D3D11_USAGE_STAGING;d.BindFlags=0;d.CPUAccessFlags=D3D11_CPU_ACCESS_READ;d.MiscFlags=0;d.StructureByteStride=0;
    if(FAILED(device->CreateBuffer(&d,nullptr,&readback))) return -4;
    D3D11_BUFFER_DESC cd={};cd.ByteWidth=16;cd.Usage=D3D11_USAGE_IMMUTABLE;cd.BindFlags=D3D11_BIND_CONSTANT_BUFFER;
    uint32_t constants[4]={count,0,0,0};D3D11_SUBRESOURCE_DATA init={};init.pSysMem=constants;
    if(FAILED(device->CreateBuffer(&cd,&init,&cb))) return -4;
    ID3D11ShaderResourceView* views[]={vv.Get(),pv.Get()};ID3D11UnorderedAccessView* outputs[]={ov.Get()};
    ID3D11Buffer* constantBuffers[]={cb.Get()};
    context->CSSetShader(shader.Get(),nullptr,0);context->CSSetShaderResources(0,2,views);
    context->CSSetUnorderedAccessViews(0,1,outputs,nullptr);context->CSSetConstantBuffers(0,1,constantBuffers);
    context->Dispatch((count+127)/128,1,1);
    ID3D11ShaderResourceView* none[2]={nullptr,nullptr};ID3D11UnorderedAccessView* noOutput=nullptr;
    context->CSSetShaderResources(0,2,none);context->CSSetUnorderedAccessViews(0,1,&noOutput,nullptr);
    context->CopyResource(readback.Get(),ob.Get());
    D3D11_MAPPED_SUBRESOURCE mapped={};
    if(FAILED(context->Map(readback.Get(),0,D3D11_MAP_READ,0,&mapped))) return -5;
    memcpy(out,mapped.pData,(size_t)count*32);context->Unmap(readback.Get(),0);
    return SUCCEEDED(device->GetDeviceRemovedReason())?1:-5;
}

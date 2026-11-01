#pragma once
#include <stdint.h>
struct GpuBspPoly {float plane[4]; uint32_t count,flags,padding[2]; float vertices[16][4];};
struct GpuBspCount {uint32_t front,back,split,uncertain;};
extern "C" int gpu_bsp_initialize(char* name,uint32_t capacity);
extern "C" int gpu_bsp_counts(const GpuBspPoly* polys,uint32_t n,const uint32_t* candidates,uint32_t nc,
                            uint32_t step,GpuBspCount* output);

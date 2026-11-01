// Exact old/new predicate oracle. These helpers are test-only and use the
// actual instruction sequences, not C++ expressions with different rounding.
__declspec(naked) static int __cdecl lightOldPredicate(float value,double limit,int kind) {
    __asm {
        cmp dword ptr [esp+16],0
        jne lessBranch
        fld dword ptr [esp+4]
        fcomp qword ptr [esp+8]
        fnstsw ax
        test ah,41h
        setnz al
        movzx eax,al
        ret
    lessBranch:
        fld dword ptr [esp+4]
        fcomp qword ptr [esp+8]
        fnstsw ax
        test ah,1
        setz al
        movzx eax,al
        ret
    }
}
__declspec(naked) static int __cdecl lightFastPredicate(float value,double limit,int kind) {
    __asm {
        cmp dword ptr [esp+16],0
        jne lessBranch
        fld qword ptr [esp+8]
        fld dword ptr [esp+4]
        fcomip st,st(1)
        fstp st(0)
        setbe al
        movzx eax,al
        ret
    lessBranch:
        fld qword ptr [esp+8]
        fld dword ptr [esp+4]
        fcomip st,st(1)
        fstp st(0)
        setae al
        movzx eax,al
        ret
    }
}
static int lightBuildTests() {
    BspControlGuard guard;_controlfp(_MCW_EM,_MCW_EM);
    const DWORD cases[]={0,0x80000000,1,0x80000001,0x007fffff,0x807fffff,
        0x00800000,0x80800000,0x7f7fffff,0xff7fffff,0x7f800000,0xff800000,
        0x7fc00000,0xffc00000,0x7f800001,0xff800001};
    unsigned seed=9127;unsigned long long checked=0;
    for(unsigned precision:{_PC_24,_PC_53,_PC_64})for(unsigned rounding:{_RC_NEAR,_RC_DOWN,_RC_UP,_RC_CHOP}) {
        _controlfp(precision|rounding,_MCW_PC|_MCW_RC);
        for(double limit:{-0.001,0.001,0.0})for(int kind=0;kind<2;kind++) {
            DWORD boundary;float center=(float)limit;memcpy(&boundary,&center,4);
            for(int i=0;i<65536;i++) {
                seed=seed*1664525+1013904223;
                DWORD bits=i<16?cases[i]:i<64?boundary+DWORD(i-40):seed;
                float value;memcpy(&value,&bits,4);
                int old=lightOldPredicate(value,limit,kind),fast=lightFastPredicate(value,limit,kind);
                if(old!=fast){say("UCMapKit|lighting test failed|bits %08x|limit %.17g|kind %d",bits,limit,kind);_clearfp();return 0;}
                checked++;
            }
        }
    }
    _clearfp();
    say("UCMapKit|lighting predicates passed|%llu cases|all x87 precision and rounding modes|threshold neighbors, signed zero, subnormals, infinities, NaNs",checked);
    return 1;
}

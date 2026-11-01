// Bounded spare capacity for the private compiler's realloc-heavy geometry
// passes. Logical sizes and contents are unchanged; the CRT still owns every
// block, and every free remains a real free. No cache survives the process.
class BuildReserveHeap {
    struct Entry {void* ptr;size_t size,capacity;};
    Entry entries[256]{};
    SRWLOCK lock=SRWLOCK_INIT;
    size_t reserved=0,peak=0;
    int used=0;
    DWORD owner=0;
    unsigned long long reused=0,avoided=0,grown=0;
    int find(void* p){if(!p||!used)return -1;for(int i=0;i<256;i++)if(entries[i].ptr==p)return i;return -1;}
    int empty(){for(int i=0;i<256;i++)if(!entries[i].ptr)return i;return -1;}
    void erase(int i){if(i>=0){reserved-=entries[i].capacity-entries[i].size;entries[i]={};used--;}}
public:
    enum {Budget=32*1024*1024,Min=64*1024,MaxSpare=1024*1024};
    void begin(bool enable) {AcquireSRWLockExclusive(&lock);owner=enable?GetCurrentThreadId():0;reused=avoided=grown=0;peak=reserved;ReleaseSRWLockExclusive(&lock);}
    void end() {AcquireSRWLockExclusive(&lock);owner=0;ReleaseSRWLockExclusive(&lock);}
    void report() {say("UCMapKit|build allocations|reused %llu|reused requested bytes %llu|grown %llu|spare peak %u",reused,avoided,grown,(unsigned)peak);}
    size_t spare(){return reserved;}
    void* resize(void* p,size_t n) {
        AcquireSRWLockExclusive(&lock);
        int slot=find(p);size_t oldSpare=slot>=0?entries[slot].capacity-entries[slot].size:0;
        if(!n){erase(slot);free(p);ReleaseSRWLockExclusive(&lock);return nullptr;}
        bool enabled=owner&&owner==GetCurrentThreadId()&&n>=Min&&n<=0x40000000;
        size_t capacity=slot>=0?entries[slot].capacity:0;
        if(enabled&&slot>=0&&n<=capacity&&n>=capacity/2&&reserved-oldSpare+capacity-n<=Budget) {
            reserved=reserved-oldSpare+capacity-n;entries[slot].size=n;
            peak=(std::max)(peak,reserved);reused++;avoided+=n;
            ReleaseSRWLockExclusive(&lock);return p;
        }
        int available=slot>=0?slot:empty();size_t requested=n;
        if(enabled&&available>=0) {
            size_t extra=(std::min)(n/4,size_t(MaxSpare));
            if(reserved-oldSpare+extra<=Budget)requested=n+extra;
        }
        void* result=realloc(p,requested);
        if(!result&&requested!=n){requested=n;result=realloc(p,n);}
        // realloc failure retains the old block and its accounting.
        if(result) {
            erase(slot);
            if(requested>n) {
                entries[available]={result,n,requested};reserved+=requested-n;used++;
                peak=(std::max)(peak,reserved);grown++;
            }
        }
        ReleaseSRWLockExclusive(&lock);return result;
    }
    void release(void* p) {AcquireSRWLockExclusive(&lock);erase(find(p));free(p);ReleaseSRWLockExclusive(&lock);}
};
class FMallocBuild : public FMallocAnsi {
public:
    BuildReserveHeap build;
    void* Realloc(void* p,DWORD size,const TCHAR*) override {return build.resize(p,size);}
    void Free(void* p) override {build.release(p);}
};

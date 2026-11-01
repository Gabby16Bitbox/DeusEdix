struct ImportLookupQuery {
    UClass* cls;UObject* outer;std::wstring name;UBOOL exact;UObject* expected;
};
static std::vector<ImportLookupQuery>* importLookupQueries=nullptr;
static int importLookupCheckQueries() {
    unsigned count=0;
    for(auto& q:*importLookupQueries) {
        UObject* found=UObject::StaticFindObject(q.cls,q.outer,(const TCHAR*)q.name.c_str(),q.exact);
        if(found!=q.expected) {
            say("UCMapKit|import lookup tests|mismatch at %u",count);
            return 0;
        }
        ++count;
    }
    say("UCMapKit|import lookup tests|%u native results identical",count);
    return 1;
}
static int importLookupTests(FOutputDevice& feedback) {
    std::vector<UObject*> objects;
    for(TObjectIterator<UObject> it;it;++it)objects.push_back(*it);
    std::vector<ImportLookupQuery> queries;
    unsigned stride=(std::max)(1u,(unsigned)objects.size()/300);
    for(unsigned i=0;i<objects.size();++i) {
        UObject* obj=objects[i];
        if(i%stride&&i+100<objects.size())continue;
        for(UClass* cls:{(UClass*)nullptr,UObject::StaticClass(),obj->GetClass(),AActor::StaticClass()}) {
            for(UObject* outer:{(UObject*)ANY_PACKAGE,(UObject*)nullptr,obj->GetOuter()}) {
                for(UBOOL exact:{0,1}) {
                    ImportLookupQuery q{cls,outer,(const wchar_t*)obj->GetName(),exact,nullptr};
                    q.expected=UObject::StaticFindObject(cls,outer,(const TCHAR*)q.name.c_str(),exact);
                    queries.push_back(q);
                }
            }
        }
    }
    for(const wchar_t* name:{L"None",L"__DeusEdixLookupMissing_739__",L"MyLevel.NoSuchActor",L"PlayerStart0",L"Light0"}) {
        ImportLookupQuery q{nullptr,(UObject*)ANY_PACKAGE,name,0,nullptr};
        q.expected=UObject::StaticFindObject(q.cls,q.outer,(const TCHAR*)q.name.c_str(),q.exact);
        queries.push_back(q);
    }
    importLookupQueries=&queries;
    int result=importLookupRun(nullptr,nullptr,feedback,&importLookupCheckQueries);
    importLookupQueries=nullptr;
    if(!importLookupSite())result=0; // original bytes were restored
    return result;
}

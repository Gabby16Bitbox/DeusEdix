// Full build batches in one private compiler. A failed command or reset ends
// the process; no subsequent batch can use a partially failed engine state.
static int residentHost() {
    if(!guardedCommand("UC_BUILD_INIT"))return 5;
    print("UCMapKit|worker-ready|1");
    bool used=false;
    std::string request;
    while(readLine(stdin,request)) {
        Json value=Json::parse(request,NULL,false);
        if(value.is_discarded()||!value.is_object()||!value.contains("folder")||!value.contains("batch")||!value.contains("id"))return 5;
        if(!value["folder"].is_string()||!value["batch"].is_string()||!value["id"].is_string())return 5;
        const std::string folder=value["folder"],batch=value["batch"],id=value["id"];
        if(id.size()!=32||id.find_first_not_of("0123456789abcdef")!=std::string::npos)return 5;
        if(used&&!guardedCommand("UC_BUILD_RESET"))return 5;
        if(!SetCurrentDirectoryW(wide(folder.c_str()).c_str()))return 5;
        FILE* input=_wfopen(wide(batch.c_str()).c_str(),L"rt");
        if(!input)return 3;
        std::string line;
        bool first=true;
        while(readLine(input,line)) {
            if(line.empty()||line[0]=='#')continue;
            if(first&&line!="MAP NEW"){fclose(input);return 5;}
            first=false;
            printf("UCMapKit|command|%s\n",line.c_str());fflush(stdout);
            DWORD at=GetTickCount();
            if(!guardedCommand(line.c_str())) {
                printf("UCMapKit|failed|%s\n",line.c_str());fflush(stdout);
                fclose(input);return 4;
            }
            printf("UCMapKit|actors|%d\n",Bridge->actorCount());
            printf("UCMapKit|complete|%lu ms\n",GetTickCount()-at);fflush(stdout);
        }
        fclose(input);
        if(first)return 5;
        used=true;
        print("UCMapKit|done");
        print(("UCMapKit|batch-end|"+id).c_str());
    }
    Bridge->stop();
    return 0;
}

import {
    exportToCsv,
    ListStorage,
    UIContainer,
    createCta,
    createSpacer,
    createTextSpan,
    HistoryTracker,
    randomString
} from 'browser-scraping-utils';

interface InstaMember {
    profileId: string
    pictureUrl: string
    username: string
    fullName: string
    isPrivate: boolean
    location?: string
    source?: string
}
class FBStorage extends ListStorage<InstaMember> {
    get headers() {
        return [
            'Profile Id',
            'Username',
            'Link',
            'Full Name',
            'Is Private',
            'Location',
            'Picture Url',
            'Source'
        ]
    }
    itemToRow(item: InstaMember): string[]{
        const link = `https://www.instagram.com/${item.username}`
        let isPrivateClean: string = "";
        if(typeof(item.isPrivate)==="boolean"){
            isPrivateClean = item.isPrivate ? "true" : "false"
        }

        return [
            item.profileId,
            item.username,
            link,
            item.fullName,
            isPrivateClean,
            item.location ? item.location : "",
            item.pictureUrl,
            item.source ? item.source : ""
        ]
    }
}



const memberListStore = new FBStorage({
    name: "insta-scrape"
});
const counterId = 'scraper-number-tracker'
const exportName = 'instaExport';
let logsTracker: HistoryTracker;

async function updateConter(){
    // Update member tracker counter
    const tracker = document.getElementById(counterId)
    if(tracker){
        const countValue = await memberListStore.getCount();
        tracker.textContent = countValue.toString()
    }
}

const uiWidget = new UIContainer();

function buildCTABtns(){
    // History Tracker
    logsTracker = new HistoryTracker({
        onDelete: async (groupId: string) => {
            // We dont have cancellable adds for now
            console.log(`Delete ${groupId}`);
            await memberListStore.deleteFromGroupId(groupId);
            await updateConter();
        },
        divContainer: uiWidget.history,
        maxLogs: 4
    })

    // Button Download
    const btnDownload = createCta();
    btnDownload.appendChild(createTextSpan('Download\u00A0'))
    btnDownload.appendChild(createTextSpan('0', {
        bold: true,
        idAttribute: counterId
    }))
    btnDownload.appendChild(createTextSpan('\u00A0users'))

    btnDownload.addEventListener('click', async function() {
        const timestamp = new Date().toISOString()
        const data = await memberListStore.toCsvData()
        try{
            exportToCsv(`${exportName}-${timestamp}.csv`, data)
        }catch(err){
            console.error('Error while generating export');
            // @ts-ignore
            console.log(err.stack)
        }
    });

    uiWidget.addCta(btnDownload)

    // Spacer
    uiWidget.addCta(createSpacer())

    // Button Reinit
    const btnReinit = createCta();
    btnReinit.appendChild(createTextSpan('Reset'))
    btnReinit.addEventListener('click', async function() {
        await memberListStore.clear();
        logsTracker.cleanLogs();
        await updateConter();
    });
    uiWidget.addCta(btnReinit);

    // Render
    uiWidget.render()

    // Initial
    window.setTimeout(()=>{
        updateConter()
    }, 1000)
}

let sourceGlobal: string | null = null;
function processResponseUsers(
    dataGraphQL: any,
    source?: string
): void{
    let data: any[];
    if(dataGraphQL?.users){ // Followings/Followers
        data = dataGraphQL.users
    }else{
        // return fast otherwise
        return;
    }

    const membersData = data.map((node)=>{
        // User Data
        const {
            pk,
            username,
            full_name,
            is_private,
            profile_pic_url
        } = node;

        const result: InstaMember = {
            profileId: pk,
            username: username,
            fullName: full_name,
            source: source,
            isPrivate: is_private,
            pictureUrl: profile_pic_url
        }
        return result
    })

    const toAdd: [string, InstaMember][] = []
    membersData.forEach(memberData=>{
        if(memberData){
            toAdd.push([memberData.profileId, memberData])
        }
    })

    const groupId = randomString(10)
    memberListStore.addElems(toAdd, false, groupId).then((added)=>{
        updateConter();

        logsTracker.addHistoryLog({
            label: source ? `Added ${source}` : 'Added items',
            numberItems: added,
            groupId: groupId,
            cancellable: false
        })
    })
}

const locationNameCache: {[key: string]: string} = {}
function saveLocationName(locationId: string, locationName: string){
    locationNameCache[locationId] = locationName;
}

function sourceString(
    sourceType: 'location' | 'tag' | 'followers' | 'following',
    value?: string
){
    switch(sourceType){
        case 'location':
            if(value){
                if(locationNameCache[value]){
                    return `post authors (loc: ${locationNameCache[value]})`
                }else if(typeof(value)==="string" && value.startsWith('%23')){
                    return `post authors (loc: ${value.replace('%23', '')})`
                }else{
                    return `post authors (loc: ${value})`
                }
            }else{
                return `post authors`
            }
        case 'tag':
            if(value){
                let valueClean = value;
                if(typeof(value)==="string" && value.startsWith('%23')){
                    valueClean = value.replace('%23', '');
                }
                return `post authors #${valueClean}`
            }else{
                return `post authors`
            }
        case 'followers':
            return `followers of ${value}`
        case 'following':
            return `following of ${value}`
    }
}


function processResponse(dataGraphQL: any, source?: string): void{
    // Only look for GraphQL responses
    let data: any[];
    let sourceImproved: string | null = null;

    if(dataGraphQL?.data){ // Tags
        sourceGlobal = dataGraphQL?.data?.name;
        data = []
        if(dataGraphQL?.data?.recent?.sections){
            data.push(...dataGraphQL?.data?.recent?.sections)
        }
        if(dataGraphQL?.data?.top?.sections){
            data.push(...dataGraphQL?.data?.top?.sections)
        }
    } else if(dataGraphQL?.media_grid?.sections){ // Place/Tag
        data = dataGraphQL?.media_grid?.sections;
    } else if(dataGraphQL?.native_location_data){ // Place
        if(dataGraphQL?.native_location_data?.location_info?.name){
            const locationName = dataGraphQL.native_location_data.location_info.name
            saveLocationName(
                dataGraphQL?.native_location_data?.location_info?.location_id,
                locationName
            )
            sourceImproved = sourceString(
                "location",
                dataGraphQL?.native_location_data?.location_info?.location_id
            )
            sourceGlobal = sourceImproved;
        }
        data = []
        if(dataGraphQL?.native_location_data?.ranked?.sections){
            data.push(...dataGraphQL?.native_location_data?.ranked?.sections)
        }
        if(dataGraphQL?.native_location_data?.recent?.sections){
            data.push(...dataGraphQL?.native_location_data?.recent?.sections)
        }
    } else if(dataGraphQL?.sections){ // Load more in places, use previous source
        data = dataGraphQL?.sections;
    } else {
        // return fast otherwise
        return;
    }

    const toCheck: any[] = [];
    
    data.forEach(sectionNode=>{
        const mediaNodes = sectionNode?.layout_content?.medias;

        if(mediaNodes && mediaNodes.length>0){
            toCheck.push(...mediaNodes)
        }

        const mediaNodes2 = sectionNode?.layout_content?.fill_items;
        if(mediaNodes2 && mediaNodes2.length>0){
            toCheck.push(...mediaNodes2)
        }
    });

    if(toCheck.length===0){
        return;
    }

    let sourceClean = sourceImproved || source || sourceGlobal;

    const membersData = toCheck.map((node)=>{
        const media = node?.media;
        if(!media){
            return null
        }
        const owner = media?.owner;
        if(!owner){
            return null;
        }

        // User Data
        const {
            pk,
            username,
            full_name,
            is_private,
            profile_pic_url
        } = owner;

        // Add Location info
        let location: string | null = null;
        if(media?.location?.name){
            location = media?.location?.name;
        }

        const result: InstaMember = {
            profileId: pk,
            username: username,
            fullName: full_name,
            isPrivate: is_private,
            pictureUrl: profile_pic_url
        }
        if(location){
            result.location = location
        }
        
        if(sourceClean){
            result.source = sourceClean;
        }

        return result
    })

    const toAdd: [string, InstaMember][] = []
    membersData.forEach(memberData=>{
        if(memberData){
            toAdd.push([memberData.profileId, memberData])
        }
    })

    const groupId = randomString(10)
    memberListStore.addElems(toAdd, false, groupId).then((added)=>{
        updateConter();

        logsTracker.addHistoryLog({
            label: sourceClean ? `Added ${sourceClean}` : 'Added items',
            numberItems: added,
            groupId: groupId,
            cancellable: false
        })
    })
}

function parseResponseExplore(
    dataGraphQL: any
){
    const items: any[] = dataGraphQL?.sectional_items
    if(!items){
        return
    }

    const toCheck: any[] = [];

    items.forEach((item: any)=>{
        if(item?.layout_content?.fill_items){
            toCheck.push(...item?.layout_content?.fill_items)
        }
    })
    if(toCheck.length===0){
        return;
    }

    const membersData = toCheck.map((node)=>{
        const media = node?.media;
        if(!media){
            return null
        }
        const owner = media?.owner;

        // User Data
        const {
            pk,
            username,
            full_name,
            is_private,
            profile_pic_url
        } = owner;

        const result: InstaMember = {
            profileId: pk,
            username: username,
            fullName: full_name,
            isPrivate: is_private,
            pictureUrl: profile_pic_url,
            source: "Explore"
        }

        return result;
    })


    const toAdd: [string, InstaMember][] = []
    membersData.forEach(memberData=>{
        if(memberData){
            toAdd.push([memberData.profileId, memberData])
        }
    })

    const groupId = randomString(10)
    memberListStore.addElems(toAdd, false, groupId).then((added)=>{
        updateConter();

        logsTracker.addHistoryLog({
            label: 'Added items from explore',
            numberItems: added,
            groupId: groupId,
            cancellable: false
        })
    })
}

function parseResponse(
    dataRaw: string,
    responseType: 'users' | 'section' | 'explore',
    source?: string
): void{
    let dataGraphQL: Array<any> = [];
    try{
        dataGraphQL.push(JSON.parse(dataRaw))
    }catch(err){
        // Sometime Server returns multiline response
        const splittedData = dataRaw.split("\n");

        // If not a multiline response
        if(splittedData.length<=1){
            console.error('Fail to parse API response', err);
            return;
        }

        // Multiline response. Parse each response
        for(let i=0; i<splittedData.length;i++){
            const newDataRaw = splittedData[i];
            try{
                dataGraphQL.push(JSON.parse(newDataRaw));
            }catch(err2){
                console.error('Fail to parse API response', err);
            }
        }
    }

    for(let j=0; j<dataGraphQL.length; j++){
        if(responseType == "section"){
            try{
                processResponse(dataGraphQL[j], source)
            }catch(err){
                console.error(err)
            }
        }else if(responseType == "users"){
            try{
                processResponseUsers(dataGraphQL[j], source)
            }catch(err){
                console.error(err)
            }
        }else if(responseType == "explore"){
            try{
                parseResponseExplore(dataGraphQL[j])
            }catch(err){
                console.error(err)
            }
        }
    }
}

const profileUsernamesCache: {[key: string]: string} = {}
async function quickProfileIdLookup(profileId: string): Promise<string | null> {
    if(typeof(profileUsernamesCache[profileId])==="string"){
        return profileUsernamesCache[profileId]
    }
    // Try to find in storage
    const instaProfile = await memberListStore.getElem(profileId)
    if(instaProfile){
        // Add in quick storage and return
        profileUsernamesCache[profileId] = instaProfile.username;
        return instaProfile.username
    }
    return null
}


function main(): void {
    buildCTABtns()

    // Watch API calls to find GraphQL responses to parse
    const regExTagsMatch = /\/api\/v1\/tags\/web_info\/\?tag_name=(?<tag_name>[\w|_|-]+)/gi;
    const regExLocationMatch = /\/api\/v1\/locations\/web_info\/?location_id=(?<location_id>[\w|_|-]+)/gi;

    const regExTagNewMatch = /\/api\/v1\/fbsearch\/web\/top_serp\/\?(?:[\w|_|-|&|=]+)query=(?<tag_name>[\w|_|-|%]+)/gi;
    
    // FetchMore
    const regExLocationFetchMore = /\/api\/v1\/locations\/(?<location_id>[\w|\d]+)\/sections\//gi

    // GenericMore
    const regExFetchMoreMatch = /\/api\/v1\/[\w|\d|\/]+\/sections\//gi

    const regExMatchFollowers = /\/api\/v1\/friendships\/(?<profile_id>\d+)\/followers\//i; // Remove g flag to reset index
    const regExMatchFollowing = /\/api\/v1\/friendships\/(?<profile_id>\d+)\/following\//i; // Remove g flag to reset index
    let send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function() {
        this.addEventListener('readystatechange', function() {

            if (this.readyState === 4) {
                if(this.responseURL.includes('/api/v1/tags/web_info')){ // Tag
                    let tagName: undefined| string;
                    const tagResult = regExTagsMatch.exec(this.responseURL);
                    regExTagsMatch.lastIndex = 0;

                    if(tagResult){
                        if(tagResult?.groups?.tag_name){
                            tagName = tagResult.groups.tag_name;
                        }
                    }
                    parseResponse(this.responseText, 'section', sourceString(
                        "tag",
                        tagName
                    ));
                } else if(this.responseURL.includes('/api/v1/locations/web_info')){ // Location
                    let locationId: undefined | string;
                    const locationRes = regExLocationMatch.exec(this.responseURL);
                    regExLocationMatch.lastIndex = 0;

                    if(locationRes){
                        if(locationRes?.groups?.location_id){
                            locationId = locationRes.groups.location_id
                        }
                    }
                    parseResponse(this.responseText, 'section', sourceString(
                        "tag",
                        locationId
                    ));
                } else if(this.responseURL.includes('/api/v1/fbsearch/web/top_serp')){ // Tag - New
                    let tagName: undefined | string;
                    const locationRes = regExTagNewMatch.exec(this.responseURL);
                    regExTagNewMatch.lastIndex = 0;

                    if(locationRes){
                        if(locationRes?.groups?.tag_name){
                            tagName = locationRes.groups.tag_name
                        }
                    }
                    parseResponse(this.responseText, 'section', sourceString(
                        "tag",
                        tagName
                    ));
                } else if(
                    this.responseURL.match(regExLocationFetchMore) // Location Fetch More
                ){
                    let locationId: undefined | string;
                    const locationRes = regExLocationFetchMore.exec(this.responseURL);
                    regExLocationFetchMore.lastIndex = 0;

                    if(locationRes){
                        if(locationRes?.groups?.location_id){
                            locationId = locationRes.groups.location_id
                        }
                    }
                    parseResponse(this.responseText, 'section', sourceString(
                        "location",
                        locationId
                    ));
                } else if(
                    this.responseURL.match(regExFetchMoreMatch) ||
                    this.responseURL.includes('/api/v1/tags/web_info')
                ){
                    parseResponse(this.responseText, 'section', 'post authors');
                } else if(this.responseURL.includes('/api/v1/discover/web/explore_grid')){ // Explore
                    parseResponse(this.responseText, 'explore', 'explore')
                }else {
                    const resultFollowers = regExMatchFollowers.exec(this.responseURL);
                    regExMatchFollowers.lastIndex = 0;

                    if(resultFollowers){
                        const profileId = resultFollowers?.groups?.profile_id;
                        if(profileId){
                            quickProfileIdLookup(profileId).then((username)=>{
                                let profileInfo = `${profileId}`;
                                if(username){
                                    profileInfo = `${profileId} (${username})`
                                }
                                parseResponse(
                                    this.responseText,
                                    'users',
                                    sourceString(
                                        "followers",
                                        profileInfo
                                    )
                                );
                            });
                        }
                    }else{
                        const resultFollowing = regExMatchFollowing.exec(this.responseURL);
                        regExMatchFollowing.lastIndex = 0;

                        if(resultFollowing){
                            const profileId = resultFollowing?.groups?.profile_id;
                            if(profileId){
                                quickProfileIdLookup(profileId).then((username)=>{
                                    let profileInfo = `${profileId}`;
                                    if(username){
                                        profileInfo = `${profileId} (${username})`
                                    }
                                    parseResponse(
                                        this.responseText,
                                        'users',
                                        sourceString(
                                            "following",
                                            profileInfo
                                        )
                                    );
                                })
                            }
                        }
                    }
                }
            }
        }, false);
        send.apply(this, arguments as any);
    };
}

main();

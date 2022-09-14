const zhiyouRegex = /^https?:\/\/zhiyou\.smzdm\.com\/user$/;
const smzdmCookieKey = "smzdm_cookie";
const smzdmCookieIdKey = "smzdm_cookie_id";
const smzdmSigninKey = "smzdm_signin";
const smzdmMissionKey = "smzdm_mission";
const smzdmLotteryKey = "smzdm_lottery";
const smzdmSyncQinglongKey = "smzdm_sync_qinglong";
const scriptName = '什么值得买';
const clickFavArticleMaxTimes = 7; // 好文收藏次数

const $ = MagicJS(scriptName, "INFO");
let currentCookie = "";

function randomStr() {
    let len = 17;
    let char = '0123456789';
    let str = ''
    for (i = 0; i < len; i++) {
        str += char.charAt(Math.floor(Math.random() * char.length));
    }
    return str;
}

$.http.interceptors.request.use((config) => {
    if (!!currentCookie) {
        config.headers.Cookie = currentCookie;
    }
    return config;
});

// Web端登录获取Cookie
async function getWebCookie() {
    try {
        currentCookie = $.request.headers.cookie || $.request.headers.Cookie;
        if (currentCookie.length >= 200) {

            $.logger.info(`当前页面获取的Cookie: ${currentCookie}`);
            const matchStr = currentCookie.match(/__ckguid=[^\s]*;/);
            const cookieId = matchStr !== null ? matchStr[0] : null;
            $.logger.info(`当前页面获取的CookieId\n${cookieId}`);
            // 获取新的session_id
            if (cookieId) {
                const userInfo = await getWebUserInfo();
                // 获取持久化的session_id
                let oldCookieId = $.data.read(smzdmCookieIdKey, "", userInfo.smzdm_id);
                $.logger.info(`从客户端存储池中读取的CookieId\n${oldCookieId}`);
                // 获取新的session_id
                $.logger.info(`旧的CookieId:\n${oldCookieId}\n新的CookieId:\n${cookieId}`);
                // 比较差异
                if (oldCookieId == cookieId) {
                    $.logger.info('当前页面获取的Cookie与客户端存储的Cookie相同，无需更新。');
                }
                else {
                    if (userInfo.blackroom_desc && userInfo.blackroom_level) {
                        $.notification.post(`⚠️您的账户已在小黑屋中，请谨慎使用自动签到和任务！\n小黑屋类型:${userInfo.blackroom_desc}\小黑屋等级:${userInfo.blackroom_level}`);
                    }
                    $.data.write(smzdmCookieIdKey, cookieId, userInfo.smzdm_id);
                    $.data.write(smzdmCookieKey, currentCookie, userInfo.smzdm_id);
                    $.logger.info(`写入cookie\n${currentCookie}`);
                    $.notification.post(scriptName, '', '🎈获取Cookie成功！！');
                }

                // 同步到青龙面板
                if ($.data.read(smzdmSyncQinglongKey, false) === true) {
                    oldCookieId = await $.qinglong.read(smzdmCookieIdKey, "", userInfo.smzdm_id);
                    $.logger.info(`从青龙面板读取的CookieId\n${oldCookieId}`);
                    if (oldCookieId !== cookieId) {
                        await $.qinglong.write(smzdmCookieIdKey, cookieId, userInfo.smzdm_id);
                        await $.qinglong.write(smzdmCookieKey, currentCookie, userInfo.smzdm_id);
                        $.logger.info(`同步cookie\n${currentCookie}`);
                        $.notification.post(scriptName, '', '🎈同步Cookie至青龙面板成功！！');
                    }
                    else {
                        $.logger.info(`当前页面获取的Cookie与青龙面板存储的Cookie相同，无需更新。`)
                    }
                }
            }
        }
        else {
            $.logger.warning('没有读取到有效的Cookie信息。');
        }
    }
    catch (err) {
        $.logger.error(`获取什么值得买Cookies出现异常，${err}`);
    }
}

// Web端签到
function webSignin() {
    return new Promise((resolve, reject) => {
        let ts = Date.parse(new Date());
        $.http.get({
            url: `https://zhiyou.smzdm.com/user/checkin/jsonp_checkin?callback=jQuery11240${randomStr()}_${ts}&_=${ts + 3}`,
            headers: {
                'Accept': '*/*',
                'Accept-Language': 'zh-cn',
                'Connection': 'keep-alive',
                'Host': 'zhiyou.smzdm.com',
                'Referer': 'https://www.smzdm.com/',
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.5 Safari/605.1.15'
            }
        }).then(resp => {
            let data = /\((.*)\)/.exec(resp.body);
            if (data) {
                let obj = JSON.parse(data[1]);
                if (!!obj && obj.hasOwnProperty('error_code')) {
                    if (obj.error_code == -1) {
                        $.logger.warning(`Web端签到出现异常，网络繁忙，接口返回：${data}`);
                        reject('Web:网络繁忙');
                    }
                    else if (obj['error_code'] == 99) {
                        $.logger.warning('Web端Cookie已过期');
                        resolve([false, 'Web:Cookie过期']);
                    }
                    else if (obj['error_code'] == 0) {
                        $.logger.info('Web:签到成功');
                        resolve([true, 'Web:签到成功']);
                    }
                    else {
                        $.logger.warning(`Web端签到出现异常，接口返回数据不合法：${data}`);
                        reject('Web:返回错误');
                    }
                }
            }
            else {
                $.logger.warning(`Web端签到出现异常，接口返回数据不存在：${data}`);
                reject('Web:签到异常');
            }
        }).catch(err => {
            $.logger.error(`Web端签到出现异常，${err}`);
            reject('Web:签到异常');
        })
    })
}

// 获取用户信息
function getWebUserInfo() {
    let userInfo = {
        "smzdm_id": null, // 什么值得买Id
        "nick_name": null, // 昵称
        "avatar": null, // 头像链接
        "has_checkin": null, // 是否签到
        "daily_checkin_num": null, // 连续签到天数
        "unread_msg": null, // 未读消息
        "level": null,  // 旧版等级
        "vip": null, // 新版VIP等级
        "exp": null, // 旧版经验
        "point": null, // 积分
        "gold": null, // 金币
        "silver": null, // 碎银子
        "prestige": null, // 威望
        "user_point_list": [], // 近期经验变动情况
        "blackroom_desc": "",
        "blackroom_level": ""
    }
    return new Promise(async resolve => {
        // 获取旧版用户信息
        await $.http.get({
            url: `https://zhiyou.smzdm.com/user/info/jsonp_get_current?with_avatar_ornament=1&callback=jQuery112403507528653716241_${new Date().getTime()}&_=${new Date().getTime()}`,
            headers: {
                'Accept': 'text/javascript, application/javascript, application/ecmascript, application/x-ecmascript, */*; q=0.01',
                'Accept-Language': 'zh-CN,zh;q=0.9',
                'Connection': 'keep-alive',
                'Host': 'zhiyou.smzdm.com',
                'Referer': 'https://zhiyou.smzdm.com/user/',
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0.3987.132 Safari/537.36'
            }
        }).then(resp => {
            let obj = JSON.parse(/\((.*)\)/.exec(resp.body)[1]);
            if (obj['smzdm_id'] !== 0) {
                userInfo.smzdm_id = obj['smzdm_id'];
                userInfo.nick_name = obj['nickname'] // 昵称
                userInfo.avatar = `https:${obj['avatar']}` // 头像链接
                userInfo.has_checkin = obj['checkin']['has_checkin'] // 是否签到
                userInfo.daily_checkin_num = obj['checkin']['daily_checkin_num'] // 连续签到天数
                userInfo.unread_msg = obj['unread']['notice']['num'] // 未读消息数
                userInfo.level = obj['level'] // 旧版等级
                userInfo.vip = obj['vip_level'] // 新版VIP等级
                userInfo.blackroom_desc = obj['blackroom_desc'] // 小黑屋描述
                userInfo.blackroom_desc = obj['blackroom_level'] // 小黑屋等级
                // userInfo.exp = obj['exp'] // 旧版经验
                // userInfo.point = obj['point'] // 积分
                // userInfo.gold = obj['gold'] // 金币
                // userInfo.silver = obj['silver'] // 碎银子
            }
            else {
                $.logger.warning(`获取用户信息异常，Cookie过期或接口变化：${JSON.stringify(obj)}`);
            }
        }).catch(err => {
            $.logger.error(`获取用户信息异常，${err}`);
        })
        // 获取新版用户信息
        await $.http.get({
            url: "https://zhiyou.smzdm.com/user/exp/",
            body: ''
        }).then(resp => {
            const data = resp.body;
            // 获取用户名
            userInfo.nick_name = data.match(/info-stuff-nickname.*zhiyou\.smzdm\.com\/user[^<]*>([^<]*)</)[1].trim();
            // 获取近期经验变动情况
            const pointTimeList = data.match(/<div class="scoreLeft">(.*)<\/div>/ig);
            const pointDetailList = data.match(/<div class=['"]scoreRight ellipsis['"]>(.*)<\/div>/ig);
            const minLength = pointTimeList.length > pointDetailList.length ? pointDetailList.length : pointTimeList.length;
            let userPointList = [];
            for (let i = 0; i < minLength; i++) {
                userPointList.push({
                    'time': pointTimeList[i].match(/\<div class=['"]scoreLeft['"]\>(.*)\<\/div\>/)[1],
                    'detail': pointDetailList[i].match(/\<div class=['"]scoreRight ellipsis['"]\>(.*)\<\/div\>/)[1]
                });
            }
            userInfo.user_point_list = userPointList;
            // 获取用户资源
            const assetsNumList = data.match(/assets-part[^<]*>(.*)</ig);
            userInfo.point = Number(assetsNumList[0].match(/assets-num[^<]*>(.*)</)[1]); // 积分
            userInfo.exp = Number(assetsNumList[2].match(/assets-num[^<]*>(.*)</)[1]); // 经验
            userInfo.gold = Number(assetsNumList[4].match(/assets-num[^<]*>(.*)</)[1]); // 金币
            userInfo.silver = Number(assetsNumList[6].match(/assets-num[^<]*>(.*)</)[1]); // 碎银子
        }).catch(err => {
            $.logger.error(`获取新版用户信息出现异常，${err}`);
        })
        // 返回结果
        resolve(userInfo);
    })
}

// 每日抽奖
function lotteryDraw() {
    return new Promise(async (resolve, reject) => {
        let activeId = "";
        await $.http.get({
            url: "https://m.smzdm.com/zhuanti/life/choujiang/",
            headers: {
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Encoding": "gzip, deflate, br",
                "Accept-Language": "zh-cn",
                "Connection": "keep-alive",
                "Host": "m.smzdm.com",
                "User-Agent":
                    "Mozilla/5.0 (iPhone; CPU iPhone OS 14_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148/smzdm 9.9.6 rv:93.4 (iPhone13,4; iOS 14.5; zh_CN)/iphone_smzdmapp/9.9.6/wkwebview/jsbv_1.0.0",
            }
        }).then(resp => {
            let _activeId = /name\s?=\s?\"lottery_activity_id\"\s+value\s?=\s?\"([a-zA-Z0-9]*)\"/.exec(resp.body);
            if (_activeId) {
                activeId = _activeId[1];
            } else {
                $.logger.warning(`获取每日抽奖activeId失败`);
            }
        }).catch(err => {
            $.logger.error(`获取每日抽奖activeId失败，${err}`);
        })
        if (!!activeId) {
            await $.http.get({
                url: `https://zhiyou.smzdm.com/user/lottery/jsonp_draw?callback=jQuery34109305207178886287_${new Date().getTime()}&active_id=${activeId}&_=${new Date().getTime()}`,
                headers: {
                    "Accept": "*/*",
                    "Accept-Encoding": "gzip, deflate, br",
                    "Accept-Language": "zh-cn",
                    "Connection": "keep-alive",
                    "Host": "zhiyou.smzdm.com",
                    "Referer": "https://m.smzdm.com/zhuanti/life/choujiang/",
                    "User-Agent":
                        "Mozilla/5.0 (iPhone; CPU iPhone OS 14_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148/smzdm 9.9.0 rv:91 (iPhone 11 Pro Max; iOS 14.2; zh_CN)/iphone_smzdmapp/9.9.0/wkwebview/jsbv_1.0.0",
                }
            }).then(resp => {
                let data = /\((.*)\)/.exec(resp.body);
                let obj = JSON.parse(data[1]);
                if (obj.error_code === 0 || obj.error_code === 1 || obj.error_code === 4) {
                    resolve(obj.error_msg);
                } else {
                    $.logger.error(`每日抽奖失败，接口响应异常：${data}`);
                    resolve("每日抽奖失败，接口响应异常");
                }
            }).catch(err => {
                $.logger.error(`每日抽奖失败，${err}`);
                resolve("每日抽奖失败，接口/执行异常");
            })
        }
    })
}

// 收藏文章
function clickFavArticle(articleId) {
    return new Promise((resolve, reject) => {
        $.http.post({
            url: "https://zhiyou.smzdm.com/user/favorites/ajax_favorite",
            headers: {
                "Accept": "application/json, text/javascript, */*; q=0.01",
                "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6",
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                "Host": "zhiyou.smzdm.com",
                "Origin": "https://post.smzdm.com",
                "Referer": "https://post.smzdm.com/",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/85.0.4183.83 Safari/537.36 Edg/85.0.564.41",
            },
            body: `article_id=${articleId}&channel_id=11&client_type=PC&event_key=%E6%94%B6%E8%97%8F&otype=%E6%94%B6%E8%97%8F&aid=${articleId}&cid=11&p=2&source=%E6%97%A0&atp=76&tagID=%E6%97%A0&sourcePage=https%3A%2F%2Fpost.smzdm.com%2F&sourceMode=%E6%97%A0`,
        }).then(resp => {
            const obj = resp.body;
            if (obj.error_code == 0) {
                $.logger.debug(`好文${articleId}收藏成功`);
                resolve(true);
            } else if (obj.error_code == 2) {
                $.logger.debug(`好文${articleId}取消收藏成功`);
                resolve(true);
            } else {
                $.logger.error(`好文${articleId}收藏失败，${JSON.stringify(obj)}`);
                resolve(false);
            }
        }).catch(err => {
            $.logger.error(`文章加入/取消收藏失败，${err}`);
            reject(false);
        })
    })
}

// 收藏文章任务
function favArticles() {
    return new Promise(async (resolve, reject) => {
        let articlesId = [];
        let success = 0;
        await $.http.get({
            url: "https://post.smzdm.com/",
            headers: {
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9",
                "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6",
                "Host": "post.smzdm.com",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/85.0.4183.83 Safari/537.36 Edg/85.0.564.41",
            },
            body: ""
        }).then(resp => {
            const articleList = resp.body.match(/data-article=".*" data-type="zan"/gi);
            articleList.forEach((element) => {
                articlesId.push(element.match(/data-article="(.*)" data-type="zan"/)[1]);
            });
        }).catch(err => {
            $.logger.error(`获取待收藏的文章列表失败，${err}`);
            reject(err);
        })
        let favArticlesId = articlesId.splice(0, clickFavArticleMaxTimes);
        if (favArticlesId.length > 0) {
            // 加入收藏
            for (let articleId of favArticlesId) {
                await $.utils.retry(clickFavArticle, 3, 500)(articleId
                ).then(result => {
                    if (result === true) {
                        success += 1;
                    }
                }).catch(err => {
                    $.logger.error(`文章加入收藏失败，${err}`);
                })
                await $.utils.sleep(500);
            }
            // 取消收藏
            for (let articleId of articlesId) {
                await $.utils.retry(clickFavArticle, 3, 500)(articleId).catch(err => {
                    $.logger.error(`文章取消收藏失败，${err}`);
                })
            }
        }
        resolve(success);
    })
}

// 多用户签到
async function multiUsersSingin() {
    const allSessions = $.data.allSessions(smzdmCookieKey);
    if (!allSessions || allSessions.length === 0) {
        $.logger.error(scriptName, "", "没有发现需要签到的Cookies\n请点击通知进行登录。", { "open-url": "https://zhiyou.smzdm.com/user/login?redirect_to=http://zhiyou.smzdm.com/user" });
    }
    else {
        $.logger.info(`当前共 ${allSessions.length} 个Cookies需要进行签到/任务。`);
        for (let [index, session] of allSessions.entries()) {
            $.logger.info(`当前正在进行第 ${index + 1} 个Cookie签到`);
            // 通知信息
            let title = '';
            let subTitle = '';
            let content = '';

            // 获取Cookies
            currentCookie = $.data.read(smzdmCookieKey, "", session);

            // 查询签到前用户数据
            const beforeUserInfo = await getWebUserInfo();

            // Web端签到
            if ($.data.read(smzdmSigninKey, true) === true) {
                await $.utils.retry(webSignin, 10, 500)().catch(err => {
                    subTitle = `Web端签到异常: ${err}`;
                });
            }

            // 日常任务
            if ($.data.read(smzdmMissionKey, true) === true) {
                const success = await favArticles();
                const msg = `每日收藏文章任务 ${success}/${clickFavArticleMaxTimes}`;
                content += !!content ? `\n${msg}` : msg;
                $.logger.info(msg);
            }

            // 抽奖
            if ($.data.read(smzdmLotteryKey, true) === true) {
                const msg = await lotteryDraw();
                content += !!content ? '\n' : '';
                content += msg;
                $.logger.info(msg);
            }

            // 休眠
            await $.utils.sleep(3000);

            // 获取签到后的用户信息
            const afterUserInfo = await getWebUserInfo();

            // 重复签到
            if (afterUserInfo.has_checkin === true && beforeUserInfo.has_checkin === true) {
                subTitle = "Web端重复签到";
            }
            else {
                subTitle = `已连续签到${afterUserInfo.daily_checkin_num}天`;
            }

            // 记录日志
            let msg = `昵称：${beforeUserInfo.nick_name}\nWeb端签到状态：${afterUserInfo.has_checkin}\n签到后等级${afterUserInfo.vip}，积分${afterUserInfo.point}，经验${afterUserInfo.exp}，金币${afterUserInfo.gold}，碎银子${afterUserInfo.silver}，未读消息${afterUserInfo.unread_msg}`;
            $.logger.info(msg);

            // 通知
            if (beforeUserInfo.exp && afterUserInfo.exp) {
                let addPoint = afterUserInfo.point - beforeUserInfo.point;
                let addExp = afterUserInfo.exp - beforeUserInfo.exp;
                let addGold = afterUserInfo.gold - beforeUserInfo.gold;
                let addSilver = afterUserInfo.silver - beforeUserInfo.silver;
                content += !!content ? '\n' : '';
                content += '积分' + afterUserInfo.point + (addPoint > 0 ? '(+' + addPoint + ')' : '') +
                    ' 经验' + afterUserInfo.exp + (addExp > 0 ? '(+' + addExp + ')' : '') +
                    ' 金币' + afterUserInfo.gold + (addGold > 0 ? '(+' + addGold + ')' : '') + '\n' +
                    '碎银子' + afterUserInfo.silver + (addSilver > 0 ? '(+' + addSilver + ')' : '') +
                    ' 未读消息' + afterUserInfo.unread_msg;
            }
            title = `${scriptName} - ${afterUserInfo.nick_name} V${afterUserInfo.vip}`;
            $.notification.post(title, subTitle, content, { 'media-url': afterUserInfo.avatar });

            $.logger.info(`第 ${index + 1} 个Cookie签到完毕`);
        }
    }
}

(async () => {
    if ($.isRequest && zhiyouRegex.test($.request.url) && $.request.method.toUpperCase() == "GET") {
        await getWebCookie();
    }
    else {
        await multiUsersSingin();
    }
    $.done();
})()

/**
 * 
 * $$\      $$\                     $$\             $$$$$\  $$$$$$\         $$$$$$\  
 * $$$\    $$$ |                    \__|            \__$$ |$$  __$$\       $$ ___$$\ 
 * $$$$\  $$$$ | $$$$$$\   $$$$$$\  $$\  $$$$$$$\      $$ |$$ /  \__|      \_/   $$ |
 * $$\$$\$$ $$ | \____$$\ $$  __$$\ $$ |$$  _____|     $$ |\$$$$$$\          $$$$$ / 
 * $$ \$$$  $$ | $$$$$$$ |$$ /  $$ |$$ |$$ /     $$\   $$ | \____$$\         \___$$\ 
 * $$ |\$  /$$ |$$  __$$ |$$ |  $$ |$$ |$$ |     $$ |  $$ |$$\   $$ |      $$\   $$ |
 * $$ | \_/ $$ |\$$$$$$$ |\$$$$$$$ |$$ |\$$$$$$$\\$$$$$$  |\$$$$$$  |      \$$$$$$  |
 * \__|     \__| \_______| \____$$ |\__| \_______|\______/  \______/        \______/ 
 *                        $$\   $$ |                                                 
 *                        \$$$$$$  |                                                 
 *                         \______/                                                                                     
 * 
*/
function MagicJS(e="MagicJS",t="INFO"){const r=()=>{const e=typeof $loon!=="undefined";const t=typeof $task!=="undefined";const n=typeof module!=="undefined";const r=typeof $httpClient!=="undefined"&&!e;const i=typeof $storm!=="undefined";const o=typeof $environment!=="undefined"&&typeof $environment["stash-build"]!=="undefined";const s=r||e||i||o;const a=typeof importModule!=="undefined";return{isLoon:e,isQuanX:t,isNode:n,isSurge:r,isStorm:i,isStash:o,isSurgeLike:s,isScriptable:a,get name(){if(e){return"Loon"}else if(t){return"QuantumultX"}else if(n){return"NodeJS"}else if(r){return"Surge"}else if(a){return"Scriptable"}else{return"unknown"}},get build(){if(r){return $environment["surge-build"]}else if(o){return $environment["stash-build"]}else if(i){return $storm.buildVersion}},get language(){if(r||o){return $environment["language"]}},get version(){if(r){return $environment["surge-version"]}else if(o){return $environment["stash-version"]}else if(i){return $storm.appVersion}else if(n){return process.version}},get system(){if(r){return $environment["system"]}else if(n){return process.platform}},get systemVersion(){if(i){return $storm.systemVersion}},get deviceName(){if(i){return $storm.deviceName}}}};const i=(n,e="INFO")=>{let r=e;const i={SNIFFER:6,DEBUG:5,INFO:4,NOTIFY:3,WARNING:2,ERROR:1,CRITICAL:0,NONE:-1};const o={SNIFFER:"",DEBUG:"",INFO:"",NOTIFY:"",WARNING:"❗ ",ERROR:"❌ ",CRITICAL:"❌ ",NONE:""};const t=(e,t="INFO")=>{if(!(i[r]<i[t.toUpperCase()]))console.log(`[${t}] [${n}]\n${o[t.toUpperCase()]}${e}\n`)};const s=e=>{r=e};return{setLevel:s,sniffer:e=>{t(e,"SNIFFER")},debug:e=>{t(e,"DEBUG")},info:e=>{t(e,"INFO")},notify:e=>{t(e,"NOTIFY")},warning:e=>{t(e,"WARNING")},error:e=>{t(e,"ERROR")},retry:e=>{t(e,"RETRY")}}};return new class{constructor(e,t){this._startTime=Date.now();this.version="3.0.0";this.scriptName=e;this.env=r();this.logger=i(e,t);this.http=typeof MagicHttp==="function"?MagicHttp(this.env,this.logger):undefined;this.data=typeof MagicData==="function"?MagicData(this.env,this.logger):undefined;this.notification=typeof MagicNotification==="function"?MagicNotification(this.scriptName,this.env,this.logger,this.http):undefined;this.utils=typeof MagicUtils==="function"?MagicUtils(this.env,this.logger):undefined;this.qinglong=typeof MagicQingLong==="function"?MagicQingLong(this.env,this.data,this.logger):undefined;if(typeof this.data!=="undefined"){let e=this.data.read("magic_loglevel");const n=this.data.read("magic_bark_url");if(e){this.logger.setLevel(e.toUpperCase())}if(n){this.notification.setBark(n)}}}get isRequest(){return typeof $request!=="undefined"&&typeof $response==="undefined"}get isResponse(){return typeof $response!=="undefined"}get isDebug(){return this.logger.level==="DEBUG"}get request(){return typeof $request!=="undefined"?$request:undefined}get response(){if(typeof $response!=="undefined"){if($response.hasOwnProperty("status"))$response["statusCode"]=$response["status"];if($response.hasOwnProperty("statusCode"))$response["status"]=$response["statusCode"];return $response}else{return undefined}}done=(e={})=>{this._endTime=Date.now();let t=(this._endTime-this._startTime)/1e3;this.logger.info(`SCRIPT COMPLETED: ${t} S.`);if(typeof $done!=="undefined"){$done(e)}}}(e,t)}function MagicHttp(u,c){const t="Mozilla/5.0 (iPhone; CPU iPhone OS 13_3_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.0.5 Mobile/15E148 Safari/604.1";const n="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/84.0.4147.125 Safari/537.36 Edg/84.0.522.59";let f;if(u.isNode){const a=require("axios");f=a.create()}class e{constructor(e=true){this.handlers=[];this.isRequest=e}use(e,t,n){this.handlers.push({fulfilled:e,rejected:t,synchronous:n?n.synchronous:false,runWhen:n?n.runWhen:null});return this.handlers.length-1}eject(e){if(this.handlers[e]){this.handlers[e]=null}}forEach(t){this.handlers.forEach(e=>{if(e!==null){t(e)}})}}function r(e){let n={...e};if(!!n.params){if(!u.isNode){let e=Object.keys(n.params).map(e=>{const t=encodeURIComponent(e);n.url=n.url.replace(new RegExp(`${e}=[^&]*`,"ig"),"");n.url=n.url.replace(new RegExp(`${t}=[^&]*`,"ig"),"");return`${t}=${encodeURIComponent(n.params[e])}`}).join("&");if(n.url.indexOf("?")<0)n.url+="?";if(!/(&|\?)$/g.test(n.url)){n.url+="&"}n.url+=e;delete n.params;c.debug(`Params to QueryString: ${n.url}`)}}return n}const d=(e,t)=>{let n=typeof t==="object"?{headers:{},...t}:{url:t,headers:{}};if(!n.method){n["method"]=e}n=r(n);if(n["rewrite"]===true){if(u.isSurge){n.headers["X-Surge-Skip-Scripting"]=false;delete n["rewrite"]}else if(u.isQuanX){n["hints"]=false;delete n["rewrite"]}}if(u.isSurge){if(n["method"]!=="GET"&&n.headers["Content-Type"].indexOf("application/json")>=0&&n.body instanceof Array){n.body=JSON.stringify(n.body);c.debug(`Convert Array object to String: ${n.body}`)}}else if(u.isQuanX){if(n.hasOwnProperty("body")&&typeof n["body"]!=="string")n["body"]=JSON.stringify(n["body"]);n["method"]=e}else if(u.isNode){if(e==="POST"||e==="PUT"||e==="PATCH"||e==="DELETE"){n.data=n.data||n.body}else if(e==="GET"){n.params=n.params||n.body}delete n.body}return n};const p=(t,n=null)=>{if(t){let e={...t,config:t.config||n,status:t.statusCode||t.status,body:t.body||t.data,headers:t.headers||t.header};if(typeof e.body==="string"){try{e.body=JSON.parse(e.body)}catch{}}delete t.data;return e}else{return t}};const i=r=>{if(!!r){delete r["Content-Length"];let e=new Set(["Accept","Accept-CH","Accept-Charset","Accept-Features","Accept-Encoding","Accept-Language","Accept-Ranges","Access-Control-Allow-Credentials","Access-Control-Allow-Origin","Access-Control-Allow-Methods","Access-Control-Allow-Headers","Access-Control-Max-Age","Access-Control-Expose-Headers","Access-Control-Request-Method","Access-Control-Request-Headers","Age","Allow","Alternates","Authorization","Cache-Control","Connection","Content-Encoding","Content-Language","ontent-Length","Content-Location","Content-Range","Content-Security-Policy","Content-Type","Cookie","DNT","Date","ETag","Expect","Expires","From","Host","If-Match","If-Modified-Since","If-None-Match","If-Range","If-Unmodified-Since","Last-Event-ID","Last-Modified","Link","Location","Max-Forwards","Negotiate","Origin","Pragma","Proxy-Authenticate","Proxy-Authorization","Range","Referer","Retry-After","Sec-Websocket-Extensions","Sec-Websocket-Key","Sec-Websocket-Origin","Sec-Websocket-Protocol","Sec-Websocket-Version","Server","Set-Cookie","Set-Cookie2","Strict-Transport-Security","TCN","TE","Trailer","Transfer-Encoding","Upgrade","User-Agent","Variant-Vary","Vary","Via","Warning","WWW-Authenticate","X-Content-Duration","X-Content-Security-Policy","X-DNSPrefetch-Control","X-Frame-Options","X-Requested-With"]);for(let n of Object.keys(r)){if(!e.has(n)){for(let t of e){let e=n.replace(new RegExp(t,"ig"),t);if(n!==e){r[e]=r[n];delete r[n];break}}}}if(!r["User-Agent"]){if(u.isNode){r["User-Agent"]=n}else{r["User-Agent"]=t}}return r}return r};const g=(t,n=null)=>{if(!!t&&t.status>=400){c.debug(`Raise exception when status code is ${t.status}`);let e={name:"RequestException",message:`Request failed with status code ${t.status}`,config:n||t.config,response:t};return e}};const o={request:new e,response:new e(false)};let y=[];let h=[];let m=true;function $(e){if(typeof e==="object"&&e["modify"]!==false){e["headers"]=i(e["headers"])}e=r(e);return e}function b(e){try{e=!!e?p(e):e;c.sniffer(`HTTP ${e.config["method"].toUpperCase()}:\n${JSON.stringify(e.config)}\nSTATUS CODE:\n${e.status}\nRESPONSE:\n${typeof e.body==="object"?JSON.stringify(e.body):e.body}`);const t=g(e);if(!!t){return Promise.reject(t)}return e}catch(t){c.error(t);return e}}const S=t=>{try{y=[];h=[];o.request.forEach(e=>{if(typeof e.runWhen==="function"&&e.runWhen(t)===false){return}m=m&&e.synchronous;y.unshift(e.fulfilled,e.rejected)});o.response.forEach(e=>{h.push(e.fulfilled,e.rejected)})}catch(e){c.error(`failed to register interceptors: ${e}`)}};const s=(e,r)=>{let i;const t=e.toUpperCase();r=d(t,r);if(u.isNode){i=f}else{if(u.isSurgeLike){i=o=>{return new Promise((r,i)=>{$httpClient[e.toLowerCase()](o,(t,n,e)=>{if(t){let e={name:t.name||t,message:t.message||t,stack:t.stack||t,config:o,response:p(n)};i(e)}else{n.config=o;n.body=e;r(n)}})})}}else{i=i=>{return new Promise((n,r)=>{$task.fetch(i).then(e=>{e=p(e,i);const t=g(e,i);if(t){return Promise.reject(t)}n(e)}).catch(e=>{let t={name:e.message||e.error,message:e.message||e.error,stack:e.error,config:i,response:!!e.response?p(e.response):null};r(t)})})}}}let o;S(r);const s=[$,undefined];const a=[b,undefined];if(!m){c.debug("Interceptors are executed in asynchronous mode");let n=[i,undefined];Array.prototype.unshift.apply(n,s);Array.prototype.unshift.apply(n,y);Array.prototype.unshift.apply(n,s);n=n.concat(a);n=n.concat(h);o=Promise.resolve(r);while(n.length){try{let e=n.shift();let t=n.shift();if(!u.isNode&&r["timeout"]&&e===i){o=l(r)}else{o=o.then(e,t)}}catch(e){c.error(`request exception: ${e}`)}}return o}else{c.debug("Interceptors are executed in synchronous mode");Array.prototype.unshift.apply(y,s);y=y.concat([$,undefined]);while(y.length){let e=y.shift();let t=y.shift();try{r=e(r)}catch(e){t(e);break}}try{if(!u.isNode&&r["timeout"]){o=l(r)}else{o=i(r)}}catch(e){return Promise.reject(e)}Array.prototype.unshift.apply(h,a);while(h.length){o=o.then(h.shift(),h.shift())}return o}function l(n){try{const e=new Promise((e,t)=>{setTimeout(()=>{let e={message:`timeout of ${n["timeout"]}ms exceeded`,config:n};t(e)},n["timeout"])});return Promise.race([i(n),e])}catch(e){c.error(`Request Timeout exception: ${e}`)}}};return{request:s,interceptors:o,modifyHeaders:i,modifyResponse:p,get:e=>{return s("GET",e)},post:e=>{return s("POST",e)},put:e=>{return s("PUT",e)},patch:e=>{return s("PATCH",e)},delete:e=>{return s("DELETE",e)},head:e=>{return s("HEAD",e)},options:e=>{return s("OPTIONS",e)}}}function MagicNotification(o,s,a,l){let u=null;let c=null;const e=t=>{try{let e=t.replace(/\/+$/g,"");u=`${/^https?:\/\/([^/]*)/.exec(e)[0]}/push`;c=/\/([^\/]+)\/?$/.exec(e)[1]}catch(e){a.error(`Bark url error: ${e}.`)}};function t(e=o,t="",n="",r=""){const i=n=>{try{let t={};if(typeof n==="string"){if(s.isLoon)t={openUrl:n};else if(s.isQuanX)t={"open-url":n};else if(s.isSurge)t={url:n}}else if(typeof n==="object"){if(s.isLoon){t["openUrl"]=!!n["open-url"]?n["open-url"]:"";t["mediaUrl"]=!!n["media-url"]?n["media-url"]:""}else if(s.isQuanX){t=!!n["open-url"]||!!n["media-url"]?n:{}}else if(s.isSurge){let e=n["open-url"]||n["openUrl"];t=e?{url:e}:{}}}return t}catch(e){a.error(`Failed to convert notification option, ${e}`)}return n};r=i(r);if(arguments.length==1){e=o;t="",n=arguments[0]}a.notify(`title:${e}\nsubTitle:${t}\nbody:${n}\noptions:${typeof r==="object"?JSON.stringify(r):r}`);if(s.isSurge){$notification.post(e,t,n,r)}else if(s.isLoon){if(!!r)$notification.post(e,t,n,r);else $notification.post(e,t,n)}else if(s.isQuanX){$notify(e,t,n,r)}if(u&&c){f(e,t,n)}}function n(e=o,t="",n="",r=""){if(a.level==="DEBUG"){if(arguments.length==1){e=o;t="",n=arguments[0]}this.notify(e,t,n,r)}}function f(e=o,t="",n="",r=""){if(typeof l==="undefined"||typeof l.post==="undefined"){throw"Bark notification needs to import MagicHttp module."}let i={url:u,headers:{"Content-Type":"application/json; charset=utf-8"},body:{title:e,body:t?`${t}\n${n}`:n,device_key:c}};l.post(i).catch(e=>{a.error(`Bark notify error: ${e}`)})}return{post:t,debug:n,bark:f,setBark:e}}function MagicData(s,a){let l={fs:undefined,data:{}};if(s.isNode){l.fs=require("fs");try{l.fs.accessSync("./magic.json",l.fs.constants.R_OK|l.fs.constants.W_OK)}catch(e){l.fs.writeFileSync("./magic.json","{}",{encoding:"utf8"})}l.data=require("./magic.json")}const u=(e,t)=>{if(typeof t==="object"){return false}else{return e===t}};const c=e=>{if(e==="true"){return true}else if(e==="false"){return false}else if(typeof e==="undefined"){return null}else{return e}};const f=(e,t,n,r)=>{if(n){try{if(typeof e==="string")e=JSON.parse(e);if(e["magic_session"]===true){e=e[n]}else{e=null}}catch{e=null}}if(typeof e==="string"&&e!=="null"){try{e=JSON.parse(e)}catch{}}if(r===false&&!!e&&e["magic_session"]===true){e=null}if((e===null||typeof e==="undefined")&&t!==null&&typeof t!=="undefined"){e=t}e=c(e);return e};const o=t=>{if(typeof t==="string"){let e={};try{e=JSON.parse(t);const n=typeof e;if(n!=="object"||e instanceof Array||n==="bool"||e===null){e={}}}catch{}return e}else if(t instanceof Array||t===null||typeof t==="undefined"||t!==t||typeof t==="boolean"){return{}}else{return t}};const d=(e,t=null,n="",r=false,i=null)=>{let o=i||l.data;if(!!o&&typeof o[e]!=="undefined"&&o[e]!==null){val=o[e]}else{val=!!n?{}:null}val=f(val,t,n,r);return val};const p=(e,t=null,n="",r=false,i=null)=>{let o="";if(i||s.isNode){o=d(e,t,n,r,i)}else{if(s.isSurgeLike){o=$persistentStore.read(e)}else if(s.isQuanX){o=$prefs.valueForKey(e)}o=f(o,t,n,r)}a.debug(`READ DATA [${e}]${!!n?`[${n}]`:""} <${typeof o}>\n${JSON.stringify(o)}`);return o};const g=(t,n,r="",e=null)=>{let i=e||l.data;i=o(i);if(!!r){let e=o(i[t]);e["magic_session"]=true;e[r]=n;i[t]=e}else{i[t]=n}if(e!==null){e=i}return i};const y=(e,t,n="",r=null)=>{if(typeof t==="undefined"||t!==t){return false}if(!s.isNode&&(typeof t==="boolean"||typeof t==="number")){t=String(t)}let i="";if(r||s.isNode){i=g(e,t,n,r)}else{if(!n){i=t}else{if(s.isSurgeLike){i=!!$persistentStore.read(e)?$persistentStore.read(e):i}else if(s.isQuanX){i=!!$prefs.valueForKey(e)?$prefs.valueForKey(e):i}i=o(i);i["magic_session"]=true;i[n]=t}}if(!!i&&typeof i==="object"){i=JSON.stringify(i,"","\t")}a.debug(`WRITE DATA [${e}]${n?`[${n}]`:""} <${typeof t}>\n${JSON.stringify(t)}`);if(!r){if(s.isSurgeLike){return $persistentStore.write(i,e)}else if(s.isQuanX){return $prefs.setValueForKey(i,e)}else if(s.isNode){try{l.fs.writeFileSync("./magic.json",i);return true}catch(e){a.error(e);return false}}}return true};const e=(t,n,r,i=u,o=null)=>{n=c(n);const e=p(t,null,r,false,o);if(i(e,n)===true){return false}else{const s=y(t,n,r,o);let e=p(t,null,r,false,o);if(i===u&&typeof e==="object"){return s}return i(n,e)}};const h=(e,t,n)=>{let r=n||l.data;r=o(r);if(!!t){obj=o(r[e]);delete obj[t];r[e]=obj}else{delete r[e]}if(!!n){n=r}return r};const t=(e,t="",n=null)=>{let r={};if(n||s.isNode){r=h(e,t,n);if(!n){l.fs.writeFileSync("./magic.json",JSON.stringify(r))}else{n=r}}else{if(!t){if(s.isStorm){return $persistentStore.remove(e)}else if(s.isSurgeLike){return $persistentStore.write(null,e)}else if(s.isQuanX){return $prefs.removeValueForKey(e)}}else{if(s.isSurgeLike){r=$persistentStore.read(e)}else if(s.isQuanX){r=$prefs.valueForKey(e)}r=o(r);delete r[t];const i=JSON.stringify(r);y(e,i)}}a.debug(`DELETE KEY [${e}]${!!t?`[${t}]`:""}`)};const n=(e,t=null)=>{let n=[];let r=p(e,null,null,true,t);r=o(r);if(r["magic_session"]!==true){n=[]}else{n=Object.keys(r).filter(e=>e!=="magic_session")}a.debug(`READ ALL SESSIONS [${e}] <${typeof n}>\n${JSON.stringify(n)}`);return n};return{read:p,write:y,del:t,update:e,allSessions:n,defaultValueComparator:u,convertToObject:o}}function MagicUtils(r,u){const e=(o,s=5,a=0,l=null)=>{return(...e)=>{return new Promise((n,r)=>{function i(...t){Promise.resolve().then(()=>o.apply(this,t)).then(e=>{if(typeof l==="function"){Promise.resolve().then(()=>l(e)).then(()=>{n(e)}).catch(e=>{if(s>=1){if(a>0)setTimeout(()=>i.apply(this,t),a);else i.apply(this,t)}else{r(e)}s--})}else{n(e)}}).catch(e=>{u.error(e);if(s>=1&&a>0){setTimeout(()=>i.apply(this,t),a)}else if(s>=1){i.apply(this,t)}else{r(e)}s--})}i.apply(this,e)})}};const t=(e,t="yyyy-MM-dd hh:mm:ss")=>{let n={"M+":e.getMonth()+1,"d+":e.getDate(),"h+":e.getHours(),"m+":e.getMinutes(),"s+":e.getSeconds(),"q+":Math.floor((e.getMonth()+3)/3),S:e.getMilliseconds()};if(/(y+)/.test(t))t=t.replace(RegExp.$1,(e.getFullYear()+"").substr(4-RegExp.$1.length));for(let e in n)if(new RegExp("("+e+")").test(t))t=t.replace(RegExp.$1,RegExp.$1.length==1?n[e]:("00"+n[e]).substr((""+n[e]).length));return t};const n=()=>{return t(new Date,"yyyy-MM-dd hh:mm:ss")};const i=()=>{return t(new Date,"yyyy-MM-dd")};const o=t=>{return new Promise(e=>setTimeout(e,t))};const s=(e,t=null)=>{if(r.isNode){const n=require("assert");if(t)n(e,t);else n(e)}else{if(e!==true){let e=`AssertionError: ${t||"The expression evaluated to a falsy value"}`;u.error(e)}}};return{retry:e,formatTime:t,now:n,today:i,sleep:o,assert:s}}function MagicQingLong(e,l,i){let o="";let s="";let a="";let u="";let c="";let t="";const f="magic.json";const n=3e3;const d=MagicHttp(e,i);const r=(e,t,n,r,i)=>{o=e;a=t;u=n;s=r;c=i};function p(e){o=o||l.read("magic_qlurl");t=t||l.read("magic_qltoken");return e}function g(e){if(!o){o=l.read("magic_qlurl")}if(e.url.indexOf(o)<0){e.url=`${o}${e.url}`}return{...e,timeout:n}}function y(e){e.params={...e.params,t:Date.now()};return e}function h(e){t=t||l.read("magic_qltoken");if(t){e.headers["Authorization"]=`Bearer ${t}`}return e}function m(e){a=a||l.read("magic_qlclient");if(!!a){e.url=e.url.replace("/api/","/open/")}return e}async function $(e){try{const t=e.message||e.error||JSON.stringify(e);if((t.indexOf("NSURLErrorDomain")>=0&&t.indexOf("-1012")>=0||!!e.response&&e.response.status===401)&&(!!e.config&&e.config.refreshToken!==true)){i.warning(`Qinglong panel token has expired`);await b();e.config["refreshToken"]=true;return await d.request(e.config.method,e.config)}else{return Promise.reject(e)}}catch(e){return Promise.reject(e)}}d.interceptors.request.use(p,undefined);d.interceptors.request.use(g,undefined);d.interceptors.request.use(m,undefined,{runWhen:e=>{return e.url.indexOf("api/user/login")<0&&e.url.indexOf("open/auth/token")<0}});d.interceptors.request.use(h,undefined,{runWhen:e=>{return e.url.indexOf("api/user/login")<0&&e.url.indexOf("open/auth/token")<0}});d.interceptors.request.use(y,undefined,{runWhen:e=>{return e.url.indexOf("open/auth/token")<0&&e.url.indexOf("t=")<0}});d.interceptors.response.use(undefined,$);async function b(){a=a||l.read("magic_qlclient");u=u||l.read("magic_qlsecrt");s=s||l.read("magic_qlname");c=c||l.read("magic_qlpwd");if(o&&a&&u){await d.get({url:`/open/auth/token`,headers:{"Content-Type":"application/json"},params:{client_id:a,client_secret:u}}).then(e=>{i.info("Log in to Qinglong panel successfully");t=e.body.data.token;l.update("magic_qltoken",t);return t}).catch(e=>{i.error(`Failed to log in to Qinglong panel.\n${e.message}`)})}else if(o&&s&&c){await d.post({url:`/api/user/login`,headers:{"Content-Type":"application/json"},body:{username:s,password:c}}).then(e=>{i.info("Log in to Qinglong panel successfully");t=e.body.data.token;l.update("magic_qltoken",t);return t}).catch(e=>{i.error(`Failed to log in to Qinglong panel.\n${e.message}`)})}}async function S(t,n,r=null){o=o||l.read("magic_qlurl");if(r===null){let e=await N([{name:t,value:n}]);if(!!e&&e.length===1){return e[0]}}else{d.put({url:`/api/envs`,headers:{"Content-Type":"application/json"},body:{name:t,value:n,id:r}}).then(e=>{if(e.body.code===200){i.debug(`QINGLONG UPDATE ENV ${t} <${typeof n}> (${r})\n${JSON.stringify(n)}`);return true}else{i.error(`Failed to update Qinglong panel environment variable.\n${JSON.stringify(e)}`)}}).catch(e=>{i.error(`Failed to update Qinglong panel environment variable.\n${e.message}`);return false})}}async function N(e){let t=[];await d.post({url:`/api/envs`,headers:{"Content-Type":"application/json"},body:e}).then(e=>{if(e.body.code===200){e.body.data.forEach(e=>{i.debug(`QINGLONG ADD ENV ${e.name} <${typeof e.value}> (${e.id})\n${JSON.stringify(e)}`);t.push(e.id)})}else{i.error(`Failed to add Qinglong panel environment variable.\n${JSON.stringify(e)}`)}}).catch(e=>{i.error(`Failed to add Qinglong panel environment variable.\n${e.message}`)});return t}async function v(t){return await d.delete({url:`/api/envs`,headers:{Accept:"application/json","Accept-Language":"zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6",Connection:"keep-alive","Content-Type":"application/json;charset=UTF-8","User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/102.0.5005.63 Safari/537.36 Edg/102.0.1245.30"},body:t}).then(e=>{if(e.body.code===200){i.debug(`QINGLONG DELETE ENV IDS: ${t}`);return true}else{i.error(`Failed to delete QingLong envs.\n${JSON.stringify(e)}`);return false}}).catch(e=>{i.error(`Failed to delete QingLong envs.\n${e.message}`)})}async function O(n=null,e=""){let r=[];await d.get({url:`/api/envs`,headers:{"Content-Type":"application/json"},params:{searchValue:e}}).then(e=>{if(e.body.code===200){const t=e.body.data;if(!!n){let e=[];for(const e of t){if(e.name===n){r.push(e)}}r=e}r=t}else{i.error(`Failed to get environment variables from Qinglong panel.\n${JSON.stringify(e)}`)}}).catch(e=>{i.error(`Failed to get environment variables from Qinglong panel.\n${JSON.stringify(e)}`)});return r}async function E(e){let t=null;const n=await O();for(const r of n){if(r.id===e){t=r;break}}return t}async function T(t){let n=false;await d.put({url:`/api/envs/disable`,headers:{Accept:"application/json","Accept-Language":"zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6",Connection:"keep-alive","Content-Type":"application/json;charset=UTF-8","User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/102.0.5005.63 Safari/537.36 Edg/102.0.1245.30"},body:t}).then(e=>{if(e.body.code===200){i.debug(`QINGLONG DISABLED ENV IDS: ${t}`);n=true}else{i.error(`Failed to disable QingLong envs.\n${JSON.stringify(e)}`)}}).catch(e=>{i.error(`Failed to disable QingLong envs.\n${e.message}`)});return n}async function w(t){let n=false;await d.put({url:`/api/envs/enable`,headers:{Accept:"application/json","Accept-Language":"zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6",Connection:"keep-alive","Content-Type":"application/json;charset=UTF-8","User-Agent":"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/102.0.5005.63 Safari/537.36 Edg/102.0.1245.30"},body:t}).then(e=>{if(e.body.code===200){i.debug(`QINGLONG ENABLED ENV IDS: ${t}`);n=true}else{i.error(`Failed to enable QingLong envs.\n${JSON.stringify(e)}`)}}).catch(e=>{i.error(`Failed to enable QingLong envs.\n${e.message}`)});return n}async function C(e,t="",n=""){let r=false;await d.post({url:`/api/scripts`,headers:{"Content-Type":"application/json"},body:{filename:e,path:t,content:n}}).then(e=>{if(e.body.code===200){r=true}else{i.error(`Failed to add script content from Qinglong panel.\n${JSON.stringify(e)}`)}}).catch(e=>{i.error(`Failed to add script content from Qinglong panel.\n${e.message}`)});return r}async function A(e,t=""){let n="";await d.get({url:`/api/scripts/${e}`,params:{path:t}}).then(e=>{if(e.body.code===200){n=e.body.data}else{i.error(`Failed to read script content from Qinglong panel.\n${JSON.stringify(e)}`)}}).catch(e=>{i.error(`Failed to read script content from Qinglong panel.\n${e.message}`)});return n}async function k(e,t="",n=""){let r=false;await d.put({url:`/api/scripts`,headers:{"Content-Type":"application/json"},body:{filename:e,path:t,content:n}}).then(e=>{if(e.body.code===200){r=true}else{i.error(`Failed to read script content from Qinglong panel.\n${JSON.stringify(e)}`)}}).catch(e=>{i.error(`Failed to read script content from Qinglong panel.\n${e.message}`)});return r}async function L(e,t=""){let n=false;await d.delete({url:`/api/scripts`,headers:{"Content-Type":"application/json"},body:{filename:e,path:t}}).then(e=>{if(e.body.code===200){n=true}else{i.error(`Failed to read script content from Qinglong panel.\n${JSON.stringify(e)}`)}}).catch(e=>{i.error(`Failed to read script content from Qinglong panel.\n${e.message}`)});return n}async function F(e,t,n=""){let r=await A(f,"");let i=l.convertToObject(r);let o=l.write(e,t,n,i);r=JSON.stringify(i,"","\t");let s=await k(f,"",r);return s&&o}async function j(e,t,n,r=l.defaultValueComparator){let i=await A(f,"");let o=l.convertToObject(i);const s=l.update(e,t,n,r,o);let a=false;if(s===true){i=JSON.stringify(o,"","\t");a=await k(f,"",i)}return s&&a}async function M(e,t,n=""){let r=await A(f,"");let i=l.convertToObject(r);const o=l.read(e,t,n,false,i);return o}async function R(e,t=""){let n=await A(f,"");let r=l.convertToObject(n);const i=l.del(e,t,r);n=JSON.stringify(r,"","\t");const o=await k(f,"",n);return i&&o}async function q(e){let t=await A(f,"");let n=l.convertToObject(t);const r=l.allSessions(e,n);return r}return{init:r,getToken:b,setEnv:S,setEnvs:N,getEnv:E,getEnvs:O,delEnvs:v,disableEnvs:T,enbleEnvs:w,addScript:C,getScript:A,editScript:k,delScript:L,write:F,read:M,del:R,update:j,allSessions:q}}
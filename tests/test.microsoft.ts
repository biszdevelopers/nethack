import {
    createMicrosoftMeeting,
    initializeDummyUserAccessToken,
} from "../server/plugins/microsoft.ts";

export async function testMicrosoftMeeting(token: string, target: string) {
    console.log("Testing Microsoft Meeting...");

    const res = await fetch(
        "https://graph.microsoft.com/v1.0/users/" + target + "/events?$top=50",
        {
            method: "GET",
            headers: {
                "Content-Type": "application/json",
                Authorization: "Bearer " + token,
            },
        },
    );

    const status = res.status;
    let data = await res.json();

    console.log("Microsoft Meeting Response: " + status);

    const meetings = [];

    meetings.push(...(data.value || []));
    console.log("Retrieved " + meetings.length + " meetings");

    while (data["@odata.nextLink"]) {
        console.log("Retrieving next page of events...");
        const nextRes = await fetch(data["@odata.nextLink"], {
            method: "GET",
            headers: {
                "Content-Type": "application/json",
                Authorization: "Bearer " + token,
            },
        });

        const nextData = await nextRes.json();
        const nextValue = nextData.value || [];
        meetings.push(...nextValue);
        data = nextData;
        console.log("Retrieved " + nextValue.length + " meetings " + new Date().getTime());
    }

    console.log(target + " has " + meetings.length + " meetings:");

    let i = 0;
    console.log("Meetings (lastest meetings first):");
    for (const meeting of meetings) {
        console.log("- " + meeting.subject + "\t" + meeting.start.dateTime);
        i++;
        if (i >= 100) {
            console.log("There are " + (meetings.length - 100) + " more meetings...");
            break;
        }
    }

    if (status == 200) {
        return true;
    }

    return false;
}

export async function testCreateMicrosoftMeeting(token: string, target: string) {
    console.log("Testing Create Microsoft Meeting...");

    const description = `<head>
<style>h1 { color: green;}</style>
</head>
<h1>Get Ready for Your Showcase!</h1>
<p>Dear Team,</p>
<p>We are excited to invite you to your upcoming showcase event! This is a fantastic opportunity to demonstrate the hard work and creativity you've put into your project. Please find the details of your showcase below:</p>`;

    const res = await createMicrosoftMeeting(
        target,
        "[BH] Showcase (Team-31)",
        description,
        new Date().toISOString(),
        new Date(Date.now() + 3600000).toISOString(),
        [
            // "Zhiyu.Jiang90454-bisz@basischina.com",
            // "test-biph@basischina.com",
            // "test3-bisz@basischina.com",
            // "TEST1101-bbsz@basischina.com",
            "ChunPing.Wong12024-bisz@basischina.com",
        ],
    );

    console.log(await res.json());

    return res.status / 100 == 2;
}

export async function testInitializeDummyUserAccessToken() {
    console.log("Testing Initialize Dummy User Access Token...");
    const token = await initializeDummyUserAccessToken();
    console.log("Dummy User Access Token initialized: " + token);

    return !!token;
}

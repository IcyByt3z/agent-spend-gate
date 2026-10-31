@IsTest
private class AgentPurchaseActionTest {
    class GateMock implements HttpCalloutMock {
        Integer statusCode;
        String body;
        HttpRequest lastRequest;

        GateMock(Integer statusCode, String body) {
            this.statusCode = statusCode;
            this.body = body;
        }

        public HttpResponse respond(HttpRequest req) {
            lastRequest = req;
            HttpResponse res = new HttpResponse();
            res.setStatusCode(statusCode);
            res.setHeader('Content-Type', 'application/json');
            res.setBody(body);
            return res;
        }
    }

    // Receipts are saved in user mode, so tests run as a user holding the demo permission set.
    static User demoUser() {
        Id psId = [SELECT Id FROM PermissionSet WHERE Name = 'Agent_Payment_Demo'].Id;
        if ([SELECT COUNT() FROM PermissionSetAssignment WHERE AssigneeId = :UserInfo.getUserId() AND PermissionSetId = :psId] == 0) {
            insert new PermissionSetAssignment(AssigneeId = UserInfo.getUserId(), PermissionSetId = psId);
        }
        return new User(Id = UserInfo.getUserId());
    }

    static AgentPurchaseAction.Request request(String domain) {
        AgentPurchaseAction.Request req = new AgentPurchaseAction.Request();
        req.domain = domain;
        return req;
    }

    @IsTest
    static void paidPurchaseIsReceipted() {
        GateMock mock = new GateMock(200,
            '{"status":"paid","data":{"demo":true,"companyName":"Acme (demo)","industry":"Retail","employees":"11-50"},'
            + '"receipt":{"id":"r-1","status":"paid","reason":"within policy","amountUsd":0.005,'
            + '"network":"eip155:84532","transaction":"0xabc"}}');
        Test.setMock(HttpCalloutMock.class, mock);

        List<AgentPurchaseAction.Result> results;
        System.runAs(demoUser()) {
            Test.startTest();
            results = AgentPurchaseAction.buy(new List<AgentPurchaseAction.Request>{ request('Acme.com') });
            Test.stopTest();
        }

        Assert.areEqual('paid', results[0].status);
        Assert.isTrue(results[0].amountUsd == 0.005, 'amount should match the gate receipt');
        Assert.isTrue(results[0].summary.contains('Acme (demo)'));
        Assert.isTrue(results[0].summary.contains('fictional demo data'));

        Map<String, Object> sent = (Map<String, Object>) JSON.deserializeUntyped(mock.lastRequest.getBody());
        Assert.areEqual(AgentPurchaseAction.SELLER_ID, sent.get('sellerId'));
        Assert.areEqual(UserInfo.getUserId(), sent.get('requestedBy'));
        Assert.areEqual('acme.com', ((Map<String, Object>) sent.get('params')).get('domain'));

        Agent_Purchase_Receipt__c saved = [
            SELECT Status__c, Amount_USD__c, Transaction__c, Gate_Receipt_Id__c FROM Agent_Purchase_Receipt__c WHERE Id = :results[0].receiptId
        ];
        Assert.areEqual('paid', saved.Status__c);
        Assert.areEqual('0xabc', saved.Transaction__c);
        Assert.areEqual('r-1', saved.Gate_Receipt_Id__c);
    }

    @IsTest
    static void blockedPurchaseIsReceiptedWithReason() {
        Test.setMock(HttpCalloutMock.class, new GateMock(200,
            '{"status":"blocked","reason":"this purchase could exceed the total budget",'
            + '"receipt":{"id":"r-2","status":"blocked","amountUsd":0,"network":null,"transaction":null}}'));

        List<AgentPurchaseAction.Result> results;
        System.runAs(demoUser()) {
            Test.startTest();
            results = AgentPurchaseAction.buy(new List<AgentPurchaseAction.Request>{ request('acme.com') });
            Test.stopTest();
        }

        Assert.areEqual('blocked', results[0].status);
        Assert.isTrue(results[0].amountUsd == 0, 'nothing should be paid');
        Assert.isTrue(results[0].summary.contains('total budget'));
        Assert.areEqual(1, [SELECT COUNT() FROM Agent_Purchase_Receipt__c WHERE Status__c = 'blocked']);
    }

    @IsTest
    static void rejectedResultIsReceiptedAsRefundOwed() {
        Test.setMock(HttpCalloutMock.class, new GateMock(200,
            '{"status":"rejected","reason":"result failed checks (asked for domain mismatch-co.com, got some-other-company.com); data withheld, seller owes a refund",'
            + '"receipt":{"id":"r-3","status":"rejected","amountUsd":0.005,"refundDueUsd":0.005,"network":"eip155:84532","transaction":"0xdef"}}'));

        List<AgentPurchaseAction.Result> results;
        System.runAs(demoUser()) {
            Test.startTest();
            results = AgentPurchaseAction.buy(new List<AgentPurchaseAction.Request>{ request('mismatch-co.com') });
            Test.stopTest();
        }

        Assert.areEqual('rejected', results[0].status);
        Assert.isTrue(results[0].amountUsd == 0.005, 'the payment that was made should be recorded');
        Assert.isTrue(results[0].summary.contains('owes a refund'));
        Assert.isFalse(results[0].summary.contains('(demo):'), 'withheld data must not be shown');
        Agent_Purchase_Receipt__c saved = [SELECT Status__c, Transaction__c, Response_JSON__c FROM Agent_Purchase_Receipt__c WHERE Id = :results[0].receiptId];
        Assert.areEqual('0xdef', saved.Transaction__c);
        Assert.isNull(saved.Response_JSON__c);
    }

    @IsTest
    static void purchaseAwaitingApprovalIsReceiptedWithItsApprovalId() {
        GateMock mock = new GateMock(200,
            '{"status":"pending_approval","reason":"needs approval: listed price $0.008 is above the $0.006 approval threshold","approvalId":"a-9",'
            + '"receipt":{"id":"r-5","status":"pending_approval","amountUsd":0,"network":null,"transaction":null,"approvalId":"a-9"}}');
        Test.setMock(HttpCalloutMock.class, mock);

        AgentPurchaseAction.Request req = request('acme.com');
        req.sellerId = 'demo-enrich-plus';
        req.costCenter = 'Sales EMEA';
        List<AgentPurchaseAction.Result> results;
        System.runAs(demoUser()) {
            Test.startTest();
            results = AgentPurchaseAction.buy(new List<AgentPurchaseAction.Request>{ req });
            Test.stopTest();
        }

        Assert.areEqual('pending_approval', results[0].status);
        Assert.isTrue(results[0].summary.contains('needs approval'));
        Map<String, Object> sent = (Map<String, Object>) JSON.deserializeUntyped(mock.lastRequest.getBody());
        Assert.areEqual('Sales EMEA', sent.get('costCenter'));
        Agent_Purchase_Receipt__c saved = [SELECT Approval_Id__c, Cost_Center__c FROM Agent_Purchase_Receipt__c WHERE Id = :results[0].receiptId];
        Assert.areEqual('a-9', saved.Approval_Id__c);
        Assert.areEqual('Sales EMEA', saved.Cost_Center__c);
    }

    @IsTest
    static void noResultIsReceiptedWithoutCharge() {
        Test.setMock(HttpCalloutMock.class, new GateMock(200,
            '{"status":"no_result","reason":"seller had no data for this request, so nothing was charged",'
            + '"receipt":{"id":"r-4","status":"no_result","amountUsd":0,"network":null,"transaction":null}}'));

        List<AgentPurchaseAction.Result> results;
        System.runAs(demoUser()) {
            Test.startTest();
            results = AgentPurchaseAction.buy(new List<AgentPurchaseAction.Request>{ request('unknown-co.com') });
            Test.stopTest();
        }

        Assert.areEqual('no_result', results[0].status);
        Assert.isTrue(results[0].amountUsd == 0, 'nothing should be charged');
        Assert.isTrue(results[0].summary.contains('nothing was charged'));
    }

    @IsTest
    static void gateErrorIsReceiptedWithoutPayment() {
        Test.setMock(HttpCalloutMock.class, new GateMock(401, '{"error":"unauthorized"}'));

        List<AgentPurchaseAction.Result> results;
        System.runAs(demoUser()) {
            Test.startTest();
            results = AgentPurchaseAction.buy(new List<AgentPurchaseAction.Request>{ request('acme.com') });
            Test.stopTest();
        }

        Assert.areEqual('error', results[0].status);
        Assert.isTrue(results[0].summary.contains('401'));
    }

    @IsTest
    static void invalidDomainIsNeverSentToTheGate() {
        GateMock mock = new GateMock(200, '{}');
        Test.setMock(HttpCalloutMock.class, mock);

        List<AgentPurchaseAction.Result> results;
        System.runAs(demoUser()) {
            Test.startTest();
            results = AgentPurchaseAction.buy(
                new List<AgentPurchaseAction.Request>{ request('https://acme.com/admin') }
            );
            Test.stopTest();
        }

        Assert.areEqual('error', results[0].status);
        Assert.isNull(mock.lastRequest);
    }
}

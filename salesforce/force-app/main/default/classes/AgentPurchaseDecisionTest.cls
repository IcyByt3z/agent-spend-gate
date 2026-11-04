@IsTest
private class AgentPurchaseDecisionTest {
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

    static final String REASON = 'Needed for the  Q4 renewal review';

    // Decisions are made by a user holding the approver permission set.
    static User approver() {
        Id psId = [SELECT Id FROM PermissionSet WHERE Name = 'Agent_Purchase_Approver'].Id;
        if ([SELECT COUNT() FROM PermissionSetAssignment WHERE AssigneeId = :UserInfo.getUserId() AND PermissionSetId = :psId] == 0) {
            insert new PermissionSetAssignment(AssigneeId = UserInfo.getUserId(), PermissionSetId = psId);
        }
        return new User(Id = UserInfo.getUserId());
    }

    static Agent_Purchase_Receipt__c pending() {
        Agent_Purchase_Receipt__c r = new Agent_Purchase_Receipt__c(
            Status__c = 'pending_approval',
            Reason__c = 'needs approval',
            Seller__c = 'demo-enrich-plus',
            Domain__c = 'acme.com',
            Approval_Id__c = 'a-1',
            Gate_Receipt_Id__c = 'r-pending',
            Amount_USD__c = 0
        );
        insert r;
        return r;
    }

    static Agent_Purchase_Receipt__c reload(Id id) {
        return [
            SELECT Status__c, Decision__c, Amount_USD__c, Transaction__c, Gate_Receipt_Id__c, Reason__c, Response_JSON__c
            FROM Agent_Purchase_Receipt__c
            WHERE Id = :id
        ];
    }

    @IsTest
    static void approvingCompletesThePurchaseOnTheSameReceipt() {
        Agent_Purchase_Receipt__c r = pending();
        GateMock mock = new GateMock(200,
            '{"status":"paid","reason":"approved, within policy","approvalId":"a-1","data":{"demo":true,"companyName":"Acme (demo)"},'
            + '"receipt":{"id":"r-paid","status":"paid","amountUsd":0.008,"network":"eip155:84532","transaction":"0xabc"}}');
        Test.setMock(HttpCalloutMock.class, mock);

        System.runAs(approver()) {
            Test.startTest();
            update new Agent_Purchase_Receipt__c(Id = r.Id, Decision__c = 'Approved', Decision_Reason__c = REASON);
            Test.stopTest();
        }

        Agent_Purchase_Receipt__c saved = reload(r.Id);
        Assert.areEqual('paid', saved.Status__c);
        Assert.areEqual('Approved', saved.Decision__c);
        Assert.isTrue(saved.Amount_USD__c == 0.008, 'amount should come from the gate');
        Assert.areEqual('0xabc', saved.Transaction__c);
        Assert.areEqual('r-paid', saved.Gate_Receipt_Id__c);
        Assert.isTrue(mock.lastRequest.getEndpoint().endsWith('/approvals/a-1/decision'));
        Map<String, Object> sent = (Map<String, Object>) JSON.deserializeUntyped(mock.lastRequest.getBody());
        Assert.areEqual('approve', sent.get('decision'));
        Assert.areEqual(UserInfo.getUserId(), sent.get('decidedBy'));
        Assert.areEqual('Needed for the Q4 renewal review', sent.get('note'));
    }

    @IsTest
    static void denyingClosesThePurchase() {
        Agent_Purchase_Receipt__c r = pending();
        GateMock mock = new GateMock(200,
            '{"status":"denied","reason":"denied by someone","approvalId":"a-1",'
            + '"receipt":{"id":"r-denied","status":"denied","amountUsd":0,"network":null,"transaction":null}}');
        Test.setMock(HttpCalloutMock.class, mock);

        System.runAs(approver()) {
            Test.startTest();
            update new Agent_Purchase_Receipt__c(Id = r.Id, Decision__c = 'Denied', Decision_Reason__c = REASON);
            Test.stopTest();
        }

        Assert.areEqual('denied', reload(r.Id).Status__c);
        Map<String, Object> sent = (Map<String, Object>) JSON.deserializeUntyped(mock.lastRequest.getBody());
        Assert.areEqual('deny', sent.get('decision'));
    }

    @IsTest
    static void aDecisionCanOnlyBeMadeOnce() {
        Agent_Purchase_Receipt__c r = pending();
        Test.setMock(HttpCalloutMock.class, new GateMock(200,
            '{"status":"denied","reason":"denied","receipt":{"id":"r-d","status":"denied","amountUsd":0}}'));

        System.runAs(approver()) {
            Test.startTest();
            update new Agent_Purchase_Receipt__c(Id = r.Id, Decision__c = 'Denied', Decision_Reason__c = REASON);
            Test.stopTest();
            try {
                update new Agent_Purchase_Receipt__c(Id = r.Id, Decision__c = 'Approved', Decision_Reason__c = REASON);
                Assert.fail('changing a decision should be rejected');
            } catch (DmlException e) {
                Assert.isTrue(e.getMessage().contains('already been made'));
            }
        }
    }

    @IsTest
    static void aDecisionNeedsAReason() {
        Agent_Purchase_Receipt__c r = pending();

        System.runAs(approver()) {
            for (String reason : new List<String>{ null, '   ', 'ok  ' }) {
                try {
                    update new Agent_Purchase_Receipt__c(Id = r.Id, Decision__c = 'Approved', Decision_Reason__c = reason);
                    Assert.fail('a decision without a reason should be rejected');
                } catch (DmlException e) {
                    Assert.isTrue(e.getMessage().contains('Say why'), e.getMessage());
                }
            }
        }
        Assert.isNull(reload(r.Id).Decision__c);
    }

    @IsTest
    static void theReasonCantBeChangedAfterTheDecision() {
        Agent_Purchase_Receipt__c r = pending();
        Test.setMock(HttpCalloutMock.class, new GateMock(200,
            '{"status":"denied","reason":"denied","receipt":{"id":"r-d","status":"denied","amountUsd":0}}'));

        System.runAs(approver()) {
            Test.startTest();
            update new Agent_Purchase_Receipt__c(Id = r.Id, Decision__c = 'Denied', Decision_Reason__c = REASON);
            Test.stopTest();
            try {
                update new Agent_Purchase_Receipt__c(Id = r.Id, Decision_Reason__c = 'A better-sounding reason');
                Assert.fail('rewriting the reason should be rejected');
            } catch (DmlException e) {
                Assert.isTrue(e.getMessage().contains('can\'t be changed'), e.getMessage());
            }
        }
    }

    @IsTest
    static void onlyPendingPurchasesCanBeDecided() {
        Agent_Purchase_Receipt__c r = new Agent_Purchase_Receipt__c(Status__c = 'paid', Amount_USD__c = 0.005, Seller__c = 'demo-enrich');
        insert r;

        System.runAs(approver()) {
            try {
                update new Agent_Purchase_Receipt__c(Id = r.Id, Decision__c = 'Approved', Decision_Reason__c = REASON);
                Assert.fail('deciding a paid purchase should be rejected');
            } catch (DmlException e) {
                Assert.isTrue(e.getMessage().contains('waiting for approval'));
            }
        }
    }

    @IsTest
    static void aDecisionTheGateNeverReceivedIsClearedForRetry() {
        Agent_Purchase_Receipt__c r = pending();
        Test.setMock(HttpCalloutMock.class, new GateMock(503, '{"error":"unavailable"}'));

        System.runAs(approver()) {
            Test.startTest();
            update new Agent_Purchase_Receipt__c(Id = r.Id, Decision__c = 'Approved', Decision_Reason__c = REASON);
            Test.stopTest();
        }

        Agent_Purchase_Receipt__c saved = reload(r.Id);
        Assert.areEqual('pending_approval', saved.Status__c);
        Assert.isNull(saved.Decision__c);
        Assert.isTrue(saved.Reason__c.contains('503'));
    }

    @IsTest
    static void agentsCannotApproveTheirOwnPurchases() {
        Agent_Purchase_Receipt__c r = pending();
        Id psId = [SELECT Id FROM PermissionSet WHERE Name = 'Agent_Payment_Demo'].Id;
        Profile minimal = [SELECT Id FROM Profile WHERE Name = 'Minimum Access - Salesforce' LIMIT 1];
        User agent = new User(
            Alias = 'agnt', Email = 'agent@example.com', EmailEncodingKey = 'UTF-8', LastName = 'Agent',
            LanguageLocaleKey = 'en_US', LocaleSidKey = 'en_US', ProfileId = minimal.Id,
            TimeZoneSidKey = 'America/Los_Angeles', UserName = 'agent' + DateTime.now().getTime() + '@example.com'
        );
        insert agent;
        insert new PermissionSetAssignment(AssigneeId = agent.Id, PermissionSetId = psId);

        System.runAs(agent) {
            try {
                Database.update(new Agent_Purchase_Receipt__c(Id = r.Id, Decision__c = 'Approved', Decision_Reason__c = REASON), AccessLevel.USER_MODE);
                Assert.fail('the agent permission set should not allow decisions');
            } catch (Exception e) {
                // User-mode DML reports missing edit access as "UPDATE not allowed".
                Assert.isTrue(e.getMessage().contains('not allowed'), e.getMessage());
            }
        }
    }
}

/**
 * Agentforce action: buys company details for a domain through the external payment gate.
 * The gate holds the wallet and enforces spending limits, approved sellers and approval
 * thresholds; this class only asks it to buy and records a receipt for every attempt.
 */
public with sharing class AgentPurchaseAction {
    @TestVisible static final String SELLER_ID = 'demo-enrich';
    static final Integer MAX_REQUESTS = 5;
    static final Pattern DOMAIN_PATTERN = Pattern.compile('^[A-Za-z0-9-]{1,63}(\\.[A-Za-z0-9-]{1,63})+$');
    static final Pattern SELLER_ID_PATTERN = Pattern.compile('^[a-z0-9-]{1,40}$');
    static final Pattern COST_CENTER_PATTERN = Pattern.compile('^[A-Za-z0-9 _.-]{1,40}$');

    public class Request {
        @InvocableVariable(
            label='Company website domain'
            description='The company domain to look up, for example acme.com. Do not include https:// or a path.'
            required=true
        )
        public String domain;

        @InvocableVariable(label='Related record ID' description='The Account or Lead this purchase is for.')
        public Id recordId;

        @InvocableVariable(
            label='Seller'
            description='Optional seller id. Leave blank to use the default seller. The payment gate blocks any seller that is not on its approved list.'
        )
        public String sellerId;

        @InvocableVariable(label='Cost center' description='Optional cost center to charge, for the monthly statement.')
        public String costCenter;
    }

    public class Result {
        @InvocableVariable(
            label='Status'
            description='paid, blocked, refused, pending_approval (waiting for a person to approve), rejected (paid but failed quality checks; refund owed), no_result (nothing charged), denied, failed or error'
        )
        public String status;

        @InvocableVariable(label='Summary' description='Plain-language result to show the user.')
        public String summary;

        @InvocableVariable(label='Amount paid (USD)')
        public Decimal amountUsd;

        @InvocableVariable(label='Receipt record ID')
        public Id receiptId;
    }

    @InvocableMethod(
        label='Buy company details (payment gate)'
        description='Buys company details for one domain from an approved data seller. Spending limits, approved sellers and approvals are enforced by the payment gate. Every attempt is saved as an Agent Purchase Receipt.'
        category='Agent Payments'
    )
    public static List<Result> buy(List<Request> requests) {
        if (requests.size() > MAX_REQUESTS) {
            throw new IllegalArgumentException('At most ' + MAX_REQUESTS + ' purchases per request.');
        }

        // All callouts happen before any record is saved: Salesforce doesn't allow a callout after DML.
        List<Agent_Purchase_Receipt__c> receipts = new List<Agent_Purchase_Receipt__c>();
        List<Result> results = new List<Result>();
        for (Request req : requests) {
            Agent_Purchase_Receipt__c receipt = callGate(req);
            receipts.add(receipt);
            Result r = new Result();
            r.status = receipt.Status__c;
            r.amountUsd = receipt.Amount_USD__c;
            r.summary = summarize(receipt);
            results.add(r);
        }

        Database.insert(receipts, AccessLevel.USER_MODE);
        for (Integer i = 0; i < results.size(); i++) {
            results[i].receiptId = receipts[i].Id;
        }
        return results;
    }

    static Agent_Purchase_Receipt__c callGate(Request req) {
        String domain = req.domain == null ? '' : req.domain.trim().toLowerCase();
        String sellerId = String.isBlank(req.sellerId) ? SELLER_ID : req.sellerId.trim().toLowerCase();
        String costCenter = req.costCenter == null ? '' : req.costCenter.trim();
        Agent_Purchase_Receipt__c receipt = new Agent_Purchase_Receipt__c(
            Seller__c = sellerId.left(80),
            Domain__c = domain.left(255),
            Related_Record_Id__c = req.recordId,
            Cost_Center__c = costCenter.left(40),
            Amount_USD__c = 0
        );

        if (!DOMAIN_PATTERN.matcher(domain).matches()) {
            return fail(receipt, 'Not a valid domain. Use a form like acme.com.');
        }
        if (!SELLER_ID_PATTERN.matcher(sellerId).matches()) {
            return fail(receipt, 'Not a valid seller id.');
        }
        if (String.isNotBlank(costCenter) && !COST_CENTER_PATTERN.matcher(costCenter).matches()) {
            return fail(receipt, 'Not a valid cost center. Use letters, numbers, spaces, dots, dashes or underscores.');
        }

        Map<String, Object> body = new Map<String, Object>{
            'sellerId' => sellerId,
            'params' => new Map<String, Object>{ 'domain' => domain },
            'requestedBy' => UserInfo.getUserId(),
            'recordId' => req.recordId == null ? '' : String.valueOf(req.recordId)
        };
        if (String.isNotBlank(costCenter)) {
            body.put('costCenter', costCenter);
        }
        return send('/purchase', body, receipt);
    }

    // Posts to the gate and fills in the receipt from its answer. Shared with approval decisions.
    public static Agent_Purchase_Receipt__c send(String path, Map<String, Object> body, Agent_Purchase_Receipt__c receipt) {
        HttpRequest http = new HttpRequest();
        http.setEndpoint('callout:Agent_Payment_Gate' + path);
        http.setMethod('POST');
        http.setHeader('Content-Type', 'application/json');
        http.setTimeout(60000);
        http.setBody(JSON.serialize(body));

        HttpResponse res;
        try {
            res = new Http().send(http);
        } catch (CalloutException e) {
            return fail(receipt, 'Could not reach the payment gate: ' + e.getMessage());
        }
        if (res.getStatusCode() != 200) {
            return fail(receipt, 'The payment gate answered ' + res.getStatusCode() + '.');
        }
        applyReply(receipt, (Map<String, Object>) JSON.deserializeUntyped(res.getBody()));
        return receipt;
    }

    static void applyReply(Agent_Purchase_Receipt__c receipt, Map<String, Object> parsed) {
        Map<String, Object> gateReceipt = (Map<String, Object>) parsed.get('receipt');
        receipt.Status__c = (String) parsed.get('status');
        receipt.Reason__c = asText(parsed.get('reason'), 'Within policy').left(255);
        if (parsed.get('approvalId') != null) {
            receipt.Approval_Id__c = (String) parsed.get('approvalId');
        }
        if (gateReceipt != null) {
            receipt.Gate_Receipt_Id__c = (String) gateReceipt.get('id');
            // JSON numbers arrive as Integer or Decimal, so convert through text.
            Object amount = gateReceipt.get('amountUsd');
            receipt.Amount_USD__c = amount == null ? 0 : Decimal.valueOf(String.valueOf(amount));
            receipt.Network__c = (String) gateReceipt.get('network');
            receipt.Transaction__c = (String) gateReceipt.get('transaction');
        }
        if (parsed.get('data') != null) {
            receipt.Response_JSON__c = JSON.serialize(parsed.get('data')).left(32768);
        }
    }

    static Agent_Purchase_Receipt__c fail(Agent_Purchase_Receipt__c receipt, String reason) {
        receipt.Status__c = 'error';
        receipt.Reason__c = reason.left(255);
        return receipt;
    }

    @TestVisible
    static String summarize(Agent_Purchase_Receipt__c receipt) {
        if (receipt.Status__c == 'pending_approval') {
            return 'This purchase needs approval before it can go ahead, so nothing has been bought yet. '
                + 'An approver can approve or deny it on the Agent Purchase Receipt. Details: ' + receipt.Reason__c;
        }
        if (receipt.Status__c == 'rejected') {
            return 'Paid $' + receipt.Amount_USD__c.stripTrailingZeros().toPlainString() + ' to ' + receipt.Seller__c
                + ', but the result failed quality checks, so it was not used. The seller owes a refund. Details: ' + receipt.Reason__c;
        }
        if (receipt.Status__c == 'no_result') {
            return 'The seller had no data for ' + receipt.Domain__c + ', so nothing was charged.';
        }
        if (receipt.Status__c != 'paid') {
            return 'Not purchased (' + receipt.Status__c + '): ' + receipt.Reason__c;
        }
        String text = 'Paid $' + receipt.Amount_USD__c.stripTrailingZeros().toPlainString() + ' to ' + receipt.Seller__c + '.';
        if (receipt.Response_JSON__c != null) {
            Map<String, Object> data = (Map<String, Object>) JSON.deserializeUntyped(receipt.Response_JSON__c);
            text += ' ' + asText(data.get('companyName'), receipt.Domain__c)
                + ': ' + asText(data.get('industry'), 'industry unknown')
                + ', ' + asText(data.get('employees'), 'size unknown') + ' employees.';
            if (data.get('demo') == true) {
                text += ' This is fictional demo data.';
            }
        }
        return text;
    }

    static String asText(Object value, String fallback) {
        return value == null ? fallback : String.valueOf(value);
    }
}

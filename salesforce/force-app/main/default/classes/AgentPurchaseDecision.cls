/**
 * Sends approvers' decisions on Agent Purchase Receipts to the payment gate and records the
 * outcome on the same receipt. Runs as a queueable because the decision is saved first and
 * Salesforce doesn't allow a callout in the same transaction as that save.
 */
public with sharing class AgentPurchaseDecision implements Queueable, Database.AllowsCallouts {
    // Stays under the per-transaction callout limit.
    @TestVisible static final Integer BATCH_SIZE = 50;
    // Set while this class clears a decision the gate never received, so it can be retried.
    @TestVisible static Boolean resettingDecision = false;

    final List<Id> receiptIds;

    public AgentPurchaseDecision(List<Id> receiptIds) {
        this.receiptIds = receiptIds;
    }

    // Matches the gate's limits on a decision note, after spaces are collapsed.
    @TestVisible static final Integer REASON_MIN = 5;

    // Called by the trigger. Rejects decisions on receipts that aren't waiting for one, and
    // decisions without a reason; a reason can't be changed once the decision is made.
    public static void beforeUpdate(List<Agent_Purchase_Receipt__c> records, Map<Id, Agent_Purchase_Receipt__c> oldMap) {
        if (resettingDecision) {
            return;
        }
        for (Agent_Purchase_Receipt__c r : records) {
            Agent_Purchase_Receipt__c old = oldMap.get(r.Id);
            if (old.Decision__c != null && r.Decision_Reason__c != old.Decision_Reason__c) {
                r.Decision_Reason__c.addError('The reason can\'t be changed after the decision is made.');
            }
            if (r.Decision__c == old.Decision__c) {
                continue;
            }
            if (old.Decision__c != null) {
                r.Decision__c.addError('A decision has already been made on this purchase.');
            } else if (old.Status__c != 'pending_approval' || String.isBlank(old.Approval_Id__c)) {
                r.Decision__c.addError('Only purchases waiting for approval can be approved or denied.');
            } else if (String.isBlank(r.Decision_Reason__c) || r.Decision_Reason__c.normalizeSpace().length() < REASON_MIN) {
                r.Decision_Reason__c.addError('Say why you are approving or denying this purchase (at least ' + REASON_MIN + ' characters).');
            }
        }
    }

    public static void afterUpdate(List<Agent_Purchase_Receipt__c> records, Map<Id, Agent_Purchase_Receipt__c> oldMap) {
        List<Id> decided = new List<Id>();
        for (Agent_Purchase_Receipt__c r : records) {
            if (oldMap.get(r.Id).Decision__c == null && r.Decision__c != null) {
                decided.add(r.Id);
            }
        }
        for (Integer i = 0; i < decided.size(); i += BATCH_SIZE) {
            List<Id> batch = new List<Id>();
            for (Integer j = i; j < Math.min(i + BATCH_SIZE, decided.size()); j++) {
                batch.add(decided[j]);
            }
            System.enqueueJob(new AgentPurchaseDecision(batch));
        }
    }

    public void execute(QueueableContext context) {
        List<Agent_Purchase_Receipt__c> receipts = [
            SELECT Id, Approval_Id__c, Decision__c, Decision_Reason__c, Status__c, Seller__c, Domain__c, Amount_USD__c, LastModifiedById
            FROM Agent_Purchase_Receipt__c
            WHERE Id IN :receiptIds AND Status__c = 'pending_approval' AND Decision__c != null
            WITH USER_MODE
        ];

        // All callouts first, then one update: Salesforce doesn't allow a callout after DML.
        List<Agent_Purchase_Receipt__c> outcomes = new List<Agent_Purchase_Receipt__c>();
        List<Agent_Purchase_Receipt__c> retries = new List<Agent_Purchase_Receipt__c>();
        for (Agent_Purchase_Receipt__c r : receipts) {
            Map<String, Object> body = new Map<String, Object>{
                'decision' => r.Decision__c == 'Approved' ? 'approve' : 'deny',
                'decidedBy' => String.valueOf(r.LastModifiedById),
                'note' => r.Decision_Reason__c == null ? '' : r.Decision_Reason__c.normalizeSpace()
            };
            Agent_Purchase_Receipt__c reply = AgentPurchaseAction.send(
                '/approvals/' + EncodingUtil.urlEncode(r.Approval_Id__c, 'UTF-8') + '/decision',
                body,
                new Agent_Purchase_Receipt__c(Seller__c = r.Seller__c, Domain__c = r.Domain__c, Amount_USD__c = 0)
            );
            if (reply.Status__c == 'error') {
                // The gate didn't take the decision: clear it so an approver can try again.
                retries.add(new Agent_Purchase_Receipt__c(Id = r.Id, Decision__c = null, Reason__c = reply.Reason__c));
            } else {
                reply.Id = r.Id;
                outcomes.add(reply);
            }
        }

        // Outcomes come from the gate, not the approver, so they are written in system mode;
        // approvers can set Decision but can't edit the status or amounts themselves.
        update as system outcomes;
        resettingDecision = true;
        try {
            update as system retries;
        } finally {
            resettingDecision = false;
        }
    }
}

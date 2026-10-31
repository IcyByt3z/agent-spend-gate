trigger AgentPurchaseReceiptTrigger on Agent_Purchase_Receipt__c (before update, after update) {
    if (Trigger.isBefore) {
        AgentPurchaseDecision.beforeUpdate(Trigger.new, Trigger.oldMap);
    } else {
        AgentPurchaseDecision.afterUpdate(Trigger.new, Trigger.oldMap);
    }
}

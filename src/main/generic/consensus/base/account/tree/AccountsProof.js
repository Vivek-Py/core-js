class AccountsProof {
    /**
     * @param {Array.<AccountsTreeNode>} nodes
     */
    constructor(nodes) {
        if (!nodes || !NumberUtils.isUint16(nodes.length) || nodes.length === 0
            || nodes.some(it => !(it instanceof AccountsTreeNode))) throw 'Malformed nodes';

        /** @type {Array.<AccountsTreeNode>} */
        this._nodes = nodes;
        /** @type {HashMap.<Hash,AccountsTreeNode>} */
        this._index = null;
    }

    /**
     * @param {SerialBuffer} buf
     * @returns {AccountsProof}
     */
    static unserialize(buf) {
        const count = buf.readUint16();
        const nodes = [];
        for (let i = 0; i < count; i++) {
            nodes.push(AccountsTreeNode.unserialize(buf));
        }
        return new AccountsProof(nodes);
    }

    /**
     * @param {?SerialBuffer} [buf]
     * @returns {SerialBuffer}
     */
    serialize(buf) {
        buf = buf || new SerialBuffer(this.serializedSize);
        buf.writeUint16(this._nodes.length);
        for (const node of this._nodes) {
            node.serialize(buf);
        }
        return buf;
    }

    /** @type {number} */
    get serializedSize() {
        let size = /*count*/ 2;
        for (const node of this._nodes) {
            size += node.serializedSize;
        }
        return size;
    }

    /**
     * Assumes nodes to be in post order and hashes nodes to check internal consistency of proof.
     * XXX Abuse this method to index the nodes contained in the proof. This forces callers to explicitly verify()
     * the proof before retrieving accounts.
     * @returns {Promise.<boolean>}
     */
    async verify() {
        /** @type {Array.<AccountsTreeNode>} */
        let children = [];
        this._index = new HashMap();
        for (const node of this._nodes) {
            // If node is a branch node, validate its children.
            if (node.isBranch()) {
                for (const child of children) {
                    const hash = await child.hash(); // eslint-disable-line no-await-in-loop
                    // If the child is not valid, return false.
                    if (!node.getChild(child.prefix).equals(hash)) {
                        return false;
                    }
                    this._index.put(hash, child);
                }
                children = [];
            }

            // Append child.
            children.push(node);
        }

        // The last element must be the root node.
        return children.length === 1 && children[0].prefix === '' && children[0].isBranch();
    }

    /**
     * @param {Address} address
     * @returns {?Account}
     */
    getAccount(address) {
        Assert.that(!!this._index, 'AccountsProof must be verified before retrieving accounts. Call verify() first.');

        const rootNode = this._nodes[this._nodes.length - 1];
        const prefix = address.toHex();
        return this._getAccount(rootNode, prefix);
    }

    /**
     * @param {AccountsTreeNode} node
     * @param {string} prefix
     * @returns {?Account}
     * @private
     */
    _getAccount(node, prefix) {
        // Find common prefix between node and requested address.
        const commonPrefix = StringUtils.commonPrefix(node.prefix, prefix);

        // If the prefix does not fully match, the requested address is not part of this node.
        if (commonPrefix.length !== node.prefix.length) return null;

        // Cut common prefix off the new address.
        prefix = prefix.substr(commonPrefix.length);

        // If the remaining address is empty, we have found the requested node.
        if (!prefix.length) return node.account;

        // Descend into the matching child node if one exists.
        const childKey = node.getChild(prefix);
        if (childKey) {
            const childNode = this._index.get(childKey);

            // If the child exists but is not part of the proof, fail.
            if (!childNode) {
                throw new Error('Requested address not part of AccountsProof');
            }

            return this._getAccount(childNode, prefix);
        }

        // No matching child exists, the requested address is not part of this node.
        return null;
    }

    /**
     * @returns {string}
     */
    toString() {
        return `AccountsProof{length=${this.length}}`;
    }

    /**
     * @returns {Promise.<Hash>}
     */
    root() {
        return this._nodes[this._nodes.length - 1].hash();
    }

    /** @type {number} */
    get length() {
        return this._nodes.length;
    }
}
Class.register(AccountsProof);

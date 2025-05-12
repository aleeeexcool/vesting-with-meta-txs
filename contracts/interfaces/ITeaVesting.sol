pragma solidity =0.8.23;

interface ITeaVesting {
    // ------------------------------------------ Errors ---------------------------------------
    error OnlyVestingOwner();

    error SignatureExpired();

    error SignatureInvalid();

    error UserIsNotExist();
    
    error VestingDisabledForYou();

    error VestingDoesNotStart();

    error VestingNothingToClaim();

    error ZeroAddress();

    error ZeroAmount();

    error WrongTokenConfig();
    // ------------------------------------------ Events ---------------------------------------
    
    /**
     * 
     * @param token Address of the presale token
     * @param from Address of the previous owner
     * @param to Address of the new owner
     */
    event TransferOwner(
        address token,
        address from,
        address to
    );

    /**
     * 
     * @param token Address of the presale token
     * @param from Address of the user
     * @param amountBurn Amount of the presale token to be locked
     * @param initialUnlock Amount of the presale token to be unlocked initially
     * @param vestedUnlock Amount of the presale token to be unlocked now since vesting started 
     */
    event Vest(
        address token,
        address from,
        uint256 amountBurn,
        uint256 initialUnlock,
        uint256 vestedUnlock
    );

    /**
     * 
     * @param token Address of the presale token
     * @param from Address of the user
     * @param amountGet Amount of the TEA tokens to be vested
     */
    event Claim(
        address token,
        address from,
        uint256 amountGet
    );

    // ------------------------------------------ Structs ---------------------------------------
    /**
     * @notice Transfer ownership signature struct
     * @param token Address of the presale token
     * @param from Address of the previous owner
     * @param to Address of the new owner
     * @param deadline Timestamp of the deadline
     * @param v ECDSA signature V
     * @param r ECDSA signature R
     * @param s ECDSA signature S
     */    
    struct OffChainStruct {
        address token;
        address from;
        address to;
        uint256 deadline;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    /**
     * @dev UserVesting struct
     * @param tokensForVesting - total tokens for to be vested (minus the initial released e.g. 10%/30%/50%)
     * @param totalVestingClaimed - total vesting tokens (from tokensForVesting) claimed by user
     */
    struct UserVesting {
        uint256 tokensForVesting; 
        uint256 totalVestingClaimed;
    }
    /**
     * @dev VestingOption struct
     * @param dateEnd - Date in timestamp when vesting is end 
     * @param dateStart - Date in timestamp when vesting is start 
     * @param dateDuration - (dateEnd - dateStart)
     * @param percentUnlock - precent of force unlock when user vest 
     */
    struct VestingOption {
        uint256 dateEnd;
        uint256 dateStart;
        uint256 dateDuration;
        uint256 percentUnlock;    
    }
    // ------------------------------------------ External functions ---------------------------------------
    function getUserUnlockReward(address tokenAddr,  address userAddr) external view returns(uint256);

    function hashTypedDataV4(bytes32 structHash) external view returns (bytes32);

    function claim(address tokenAddr, address userAddr) external;

    function vest(address tokenAddr, uint256 tokenAmount) external;

    function transferOwnerOnChain(address tokenAddr, address from, address owner_) external; 

    function transferOwnerOffChain(OffChainStruct calldata _offChainStruct) external;
}